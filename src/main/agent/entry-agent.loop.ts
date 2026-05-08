import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { extractLastAiText } from './main-agent';
import {
  extractTextFromToken,
  extractThinkingFromToken,
  getEventDedupKey,
  shouldEmitToolEventToFrontend,
  stripRawToolJson,
  tryBuildToolResultSummary,
  tryParseCustomEvent,
  unwrapJsonText,
} from './entry-agent.helpers';
import type {
  AgentFrontendEvent,
  RunLoopParams,
  StreamContext,
  StreamHandlers,
} from './entry-agent.types';

export type AgentLike = {
  invoke: (
    input: { messages: BaseMessage[] },
    options?: unknown
  ) => Promise<{ messages?: BaseMessage[] }>;
  stream: (
    input: { messages: BaseMessage[] },
    options?: unknown
  ) => Promise<AsyncIterable<unknown>>;
};

export type PlannerModelLike = {
  invoke: (
    messages: BaseMessage[],
    options?: { signal?: AbortSignal }
  ) => Promise<{
    content?: unknown;
  }>;
};

export class EntryAgentLoop {
  /** LangGraph 递归深度上限，防止工具调用栈过深 */
  private readonly recursionLimit = Number(
    process.env.AGENT_RECURSION_LIMIT ?? '80'
  );
  /** 单轮 Agent 最多允许工具调用次数，防止死循环 */
  private readonly maxToolCallsPerTurn = Number(
    process.env.AGENT_MAX_TOOL_CALLS_PER_TURN ?? '25'
  );
  /** DB 任务中 SQL 方案最多迭代次数（通常对应 generate_sql 调用次数） */
  private readonly maxDbLoopIterations = Number(
    process.env.AGENT_MAX_DB_LOOP_ITERATIONS ?? '5'
  );
  /** 同一工具相同参数最多重复调用次数，防止抖动循环 */
  private readonly maxRepeatedSameToolCall = Number(
    process.env.AGENT_MAX_REPEATED_SAME_TOOL_CALL ?? '2'
  );
  constructor(
    private readonly agent: AgentLike,
    private readonly plannerModel: PlannerModelLike,
    private readonly eventDedupLimit: number
  ) {}

  private now() {
    return Date.now();
  }

  private formatElapsed(ms: number) {
    return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
  }

  /**
   * LLM 调用信号：
   * - 不再设置内部超时
   * - 仅响应外部用户取消（parentSignal）
   */
  private createLlmCallSignal(
    parentSignal?: AbortSignal
  ): AbortSignal | undefined {
    return parentSignal;
  }

  // ===========================================================================
  // 路由决策
  // ===========================================================================

  /**
   * 判断用户意图：
   * - db_query：用户明确或隐含需要查询数据库（统计、分析、明细、报表等）
   * - direct_answer：普通问答、闲聊、外部资讯，无需查数据库
   *
   * 路由失败时默认回退为 direct_answer，避免因模型异常影响主流程。
   */
  private async decideExecutionMode(
    message: string,
    signal?: AbortSignal
  ): Promise<{ mode: 'db_query' | 'direct_answer'; reason: string }> {
    try {
      const response = await this.plannerModel.invoke(
        [
          new SystemMessage(
            [
              '你是任务路由器，只输出 JSON，格式：{"mode":"db_query|direct_answer","reason":"..."}',
              '路由规则：',
              '1) db_query：用户明确或隐含需要查询数据库（统计、查表、分析数据、明细、报表、查用户等）。',
              '2) direct_answer：普通问答、闲聊、外部资讯，无需查数据库。',
              '只输出 JSON，不要 markdown，不要额外说明。',
            ].join('\n')
          ),
          new HumanMessage(`用户请求：${message}`),
        ],
        { signal: this.createLlmCallSignal(signal) }
      );
      const raw = unwrapJsonText(String(response.content ?? ''));
      const parsed = JSON.parse(raw) as { mode?: unknown; reason?: unknown };
      const mode = parsed.mode === 'db_query' ? 'db_query' : 'direct_answer';
      const reason =
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : '无';
      return { mode, reason };
    } catch {
      return { mode: 'direct_answer', reason: '路由判断异常，回退为普通回答' };
    }
  }

  // ================================================@===========================
  // 主入口
  // ===========================================================================

  /**
   * 执行入口：先路由判断，再分发到对应链路：
   * - db_query      → 交由 Agent + DB tools 自主迭代（SQL 不满足时自动重试）
   * - direct_answer → 直接调用 LangGraph Agent 回答（支持联网搜索等工具）
   */
  async runLoopWithPlan(params: RunLoopParams): Promise<string> {
    const { message, streamCtx, signal } = params;
    this.emitStreamEvent(
      streamCtx,
      {
        kind: 'agent_step',
        step: 'route_decision',
        message: '正在判断任务类型…',
      },
      true
    );

    const routeStartedAt = this.now();
    const routing = await this.decideExecutionMode(message, signal);
    const routeElapsed = this.now() - routeStartedAt;

    this.emitStreamEvent(
      streamCtx,
      {
        kind: 'agent_step',
        step: 'route_decision',
        message: `任务类型：${
          routing.mode === 'db_query' ? '数据库查询' : '普通回答'
        }（耗时 ${this.formatElapsed(routeElapsed)}${
          routing.reason ? '；原因：' + routing.reason : ''
        }）`,
      },
      true
    );

    if (routing.mode === 'db_query') {
      return this.runDbQueryAgentLoop(params);
    }

    // 普通任务：直接交由 LangGraph Agent 处理
    return this.runSingleAgentTurn(params);
  }

  // ===========================================================================
  // 数据库查询链路（Agent 自主循环）
  // ===========================================================================

  /**
   * db_query 路由不再走固定流程，而是交给 Agent 在 DB tools 上自主迭代：
   * - 允许 SQL 生成/校验/执行失败后自动修正并重试
   * - 由工具调用保护机制兜底，避免无限循环
   */
  private async runDbQueryAgentLoop(params: RunLoopParams): Promise<string> {
    const { message, history, streamCtx, signal } = params;
    // this.emitStreamEvent(
    //   streamCtx,
    //   {
    //     kind: 'agent_step',
    //     step: 'db_agent_loop',
    //     message: '进入数据库查询模式，Agent 将自动迭代 SQL 直到结果满足问题',
    //   },
    //   true
    // );

    const dbTaskMessage = [
      '你正在处理数据库查询任务。',
      '请使用数据库工具进行自动循环：get_table_catalog -> get_table_schema(候选表) -> generate_sql -> validate_sql -> run_sql。',
      '不要一开始拉取全库字段；先根据表目录缩小候选范围，再获取详细字段。',
      'get_table_schema 的返回仅用于内部推理，禁止在对用户的可见输出中原样打印完整 JSON 或全量字段清单。',
      '若确需说明结构，只允许给出与当前问题直接相关的少量关键字段（精简摘要）。',
      '如果 SQL 校验失败、执行报错、结果为空或与问题不匹配，必须基于失败信息继续重试。',
      '重试时必须在 generate_sql 中传入 previousSql 与 feedback，直到得到可回答问题的数据。',
      '',
      `用户原始问题：${message}`,
    ].join('\n');

    return this.runSingleAgentTurn({
      message: dbTaskMessage,
      history,
      streamCtx,
      signal,
    });
  }

  // ===========================================================================
  // LangGraph Agent 单轮执行
  // ===========================================================================

  /**
   * 调用 LangGraph Agent 执行单轮对话：
   * - 无 streamCtx（非流式）：invoke 模式，等待完整响应后返回
   * - 有 streamCtx（流式）：stream 模式，token 增量实时推送给前端
   *
   * 内置工具调用保护机制：
   * - 单轮工具调用总次数上限（防死循环）
   * - 同一工具相同参数重复调用次数上限（防抖动循环）
   */
  private async runSingleAgentTurn(params: RunLoopParams): Promise<string> {
    const { message, history, streamCtx, signal } = params;

    if (!streamCtx) {
      // 非流式：直接 invoke，等待最终消息列表
      const response = await this.agent.invoke(
        {
          messages: [...history, new HumanMessage(message)],
        },
        {
          signal: this.createLlmCallSignal(signal),
          recursionLimit: this.recursionLimit,
        }
      );
      return extractLastAiText(response.messages ?? []);
    }

    // 流式：订阅三种 streamMode
    let content = '';
    let toolCallCount = 0;
    let dbLoopCount = 0;
    const sameToolCallCounter = new Map<string, number>();

    const stream = await this.agent.stream(
      {
        messages: [...history, new HumanMessage(message)],
      },
      {
        // streamMode 说明：
        // - messages：LLM token 增量，用于前端逐字渲染
        // - updates ：Agent 状态更新（tool_calls / ToolMessage），用于显示工具调用过程
        // - custom  ：工具内 runtime.writer 发出的自定义进度事件
        streamMode: ['updates', 'messages', 'custom'],
        signal: this.createLlmCallSignal(signal),
        recursionLimit: this.recursionLimit,
      }
    );

    for await (const chunk of stream) {
      if (streamCtx.controller?.signal.aborted) break;
      if (!Array.isArray(chunk) || typeof chunk[0] !== 'string') continue;

      const [mode, payload] = chunk as unknown as [string, unknown];

      if (mode === 'messages') {
        const [token] = payload as unknown as [unknown, unknown];

        // 深度思考模式：提取 reasoning_content 增量并推送前端
        const thinkingDelta = extractThinkingFromToken(token);
        if (thinkingDelta) {
          this.emitStreamEvent(
            streamCtx,
            { kind: 'thinking_chunk', message: thinkingDelta },
            false
          );
        }

        const delta = stripRawToolJson(
          extractTextFromToken(token),
          streamCtx.rawToolJsonState
        );
        if (!delta) continue;
        content += delta;
        streamCtx.handlers?.onChunk?.(delta);
        continue;
      }

      if (mode === 'custom') {
        const evt = tryParseCustomEvent(payload);
        if (evt) this.emitStreamEvent(streamCtx, evt, true);
        continue;
      }

      if (mode === 'updates') {
        this.emitEventsFromUpdates(payload, streamCtx, {
          onToolCall: (tool, args) => {
            toolCallCount += 1;
            const key = `${tool}:${JSON.stringify(args ?? null)}`;
            const repeated = (sameToolCallCounter.get(key) ?? 0) + 1;
            sameToolCallCounter.set(key, repeated);

            if (tool === 'generate_sql') {
              dbLoopCount += 1;
              if (dbLoopCount > this.maxDbLoopIterations) {
                throw new Error(
                  `触发保护：数据库 SQL 迭代次数 ${dbLoopCount} 超过上限 ${this.maxDbLoopIterations}，已中断循环`
                );
              }
            }

            if (toolCallCount > this.maxToolCallsPerTurn) {
              throw new Error(
                `触发保护：单轮工具调用次数 ${toolCallCount} 超过上限 ${this.maxToolCallsPerTurn}，已中断以避免循环`
              );
            }
            if (repeated > this.maxRepeatedSameToolCall) {
              throw new Error(
                `触发保护：工具 ${tool} 相同参数重复调用 ${repeated} 次，已中断以避免循环`
              );
            }
          },
        });
      }
    }

    return content;
  }

  // ===========================================================================
  // 流式事件处理
  // ===========================================================================

  /**
   * 从 LangGraph updates 流中解析工具调用/结果事件，并转发给前端。
   * guard.onToolCall 用于触发调用次数保护机制。
   */
  private emitEventsFromUpdates(
    payload: unknown,
    streamCtx?: StreamContext,
    guard?: {
      onToolCall?: (tool: string, args?: unknown) => void;
    }
  ) {
    if (!payload || typeof payload !== 'object') return;

    const updateObj = payload as Record<string, unknown>;
    const [step, value] = Object.entries(updateObj)[0] ?? [];
    if (!step) return;

    const messages = (value as { messages?: unknown[] })?.messages;
    if (!Array.isArray(messages)) return;

    let hasToolCalls = false;

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;

      // AI 消息：检查是否包含工具调用
      const toolCalls = (msg as { tool_calls?: unknown })?.tool_calls;
      const parsedToolCalls = Array.isArray(toolCalls)
        ? (toolCalls as Array<{ name?: unknown; args?: unknown }>)
        : [];

      if (parsedToolCalls.length > 0) {
        for (const call of parsedToolCalls) {
          const tool =
            typeof call?.name === 'string' ? call.name : 'unknown_tool';
          guard?.onToolCall?.(tool, call?.args);
          if (!shouldEmitToolEventToFrontend(tool)) {
            continue;
          }
          hasToolCalls = true;
          this.emitStreamEvent(
            streamCtx,
            {
              kind: 'tool_call',
              tool,
              args: call?.args,
              message: `准备调用工具：${tool}`,
            },
            true
          );
        }
        continue;
      }

      // ToolMessage 判断：必须有 tool_call_id 才是真正的工具返回消息。
      // LangGraph 的 AIMessage 也携带 name 字段（节点名），不能仅凭 name 判断。
      const toolCallId = (msg as { tool_call_id?: unknown }).tool_call_id;
      if (!toolCallId) continue;

      const toolName =
        typeof (msg as { name?: unknown }).name === 'string'
          ? ((msg as { name: string }).name as string)
          : undefined;
      if (toolName) {
        if (!shouldEmitToolEventToFrontend(toolName)) {
          continue;
        }
        const resultSummary = tryBuildToolResultSummary(
          toolName,
          (msg as { content?: unknown }).content
        );
        this.emitStreamEvent(
          streamCtx,
          {
            kind: 'tool_result',
            tool: toolName,
            message: resultSummary ?? `工具已返回：${toolName}`,
          },
          true
        );
      }
    }

    // 只在该步骤确实触发了工具调用时，才向前端通报"进入步骤"。
    // 模型纯文本生成步骤（agent / model_request 等）不产生可见事件。
    if (hasToolCalls) {
      this.emitStreamEvent(
        streamCtx,
        { kind: 'agent_step', step, message: `进入步骤：${step}` },
        true
      );
    }
  }

  /**
   * 向前端发送一个 AgentFrontendEvent。
   * dedup=true 时对相同事件去重，避免重复展示（使用 LRU 式滑动窗口）。
   */
  private emitStreamEvent(
    streamCtx:
      | {
          handlers?: StreamHandlers;
          eventDedupKeys?: Set<string>;
        }
      | undefined,
    event: AgentFrontendEvent,
    dedup = false
  ) {
    if (!streamCtx?.handlers?.onEvent) return;

    if (dedup) {
      const key = getEventDedupKey(event);
      const keys = streamCtx.eventDedupKeys;
      if (keys) {
        if (keys.has(key)) return;
        keys.add(key);
        // 超出去重窗口大小时淘汰最早的 key
        if (keys.size > this.eventDedupLimit) {
          const first = keys.values().next();
          if (!first.done) keys.delete(first.value);
        }
      }
    }

    streamCtx.handlers.onEvent(event);
  }
}
