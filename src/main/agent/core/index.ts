import { EventEmitter } from 'node:events';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { MessagesValue, START, StateSchema } from '@langchain/langgraph';
import { createModel } from '../model';
import { createAgentTools } from '../tools';
import { extractLastAiText } from './utils';
import { buildMainAgentSystemPrompt } from './prompt';
import {
  extractThinkingFromToken,
  getEventDedupKey,
  tryParseCustomEvent,
} from './helpers';
import type {
  AgentFrontendEvent,
  RunAgentParams,
  StreamHandlers,
} from './types';
import type { AgentManager } from '..';
import { formatMysqlCatalogForPrompt } from '../utils/format-mysql-catalog';

export type { AgentFrontendEvent } from './types';

/**
 * 主进程 Agent：LangChain createAgent + MemorySaver + thread_id。
 * 持有 {@link AgentManager} 引用；表目录可由启动预取或 get_table_catalog 工具写入父管理器。
 */
export class Agent extends EventEmitter {
  /** LangChain `createAgent` 返回的 ReactAgent：`invoke` / `stream` + `graph.updateState` */
  private readonly agent: ReturnType<typeof createAgent>;
  private readonly sessionAbortMap = new Map<string, AbortController>();
  private readonly eventDedupLimit = Number(
    process.env.AGENT_EVENT_DEDUP_LIMIT ?? '300'
  );
  private readonly recursionLimit = Number(
    process.env.AGENT_RECURSION_LIMIT ?? '80'
  );

  readonly manager: AgentManager;

  constructor(manager: AgentManager) {
    super();
    this.manager = manager;

    const agentModel = createModel({
      temperature: 0.2,
      maxTokens: 8192,
    }) as unknown as NonNullable<
      Parameters<typeof createAgent>[0]['model']
    >;

    const AgentState = new StateSchema({
      messages: MessagesValue,
    });

    const compiled = createAgent({
      model: agentModel,
      tools: createAgentTools({
        onMysqlCatalogSynced: (catalog) => {
          this.manager.mysqlSchemaCatalogText =
            formatMysqlCatalogForPrompt(catalog);
        },
      }),
      systemPrompt: buildMainAgentSystemPrompt(
        this.manager.mysqlSchemaCatalogText,
        this.manager.ragDocumentsPromptText,
        this.manager.skillsPromptText
      ),
      stateSchema: AgentState,
    });
    compiled.checkpointer = new MemorySaver();
    this.agent = compiled;
  }

  /**
   * 将历史消息写入 LangGraph MemorySaver（对应 thread_id），仅在新建会话且库中有记录时调用。
   */
  async addPriorThreadMessages(
    threadId: string,
    messages: BaseMessage[]
  ): Promise<void> {
    const id = threadId.trim();
    if (!id || messages.length === 0) return;
    await this.agent.graph.updateState(
      { configurable: { thread_id: id } },
      { messages },
      START
    );
  }

  async agentRequest(
    input: string,
    sessionId = 'default',
    handlers?: StreamHandlers
  ) {
    const message = input.trim();
    if (!message) {
      handlers?.onDone?.('');
      return '';
    }

    this.emit('agent:request', message);
    const controller = new AbortController();
    this.sessionAbortMap.set(sessionId, controller);

    let content = '';
    try {
      content = await this.runAgent({
        message,
        threadId: sessionId,
        streamCtx: {
          handlers,
          controller,
          eventDedupKeys: new Set<string>(),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (!this.isAbortError(error)) {
        throw error;
      }
    } finally {
      if (this.sessionAbortMap.get(sessionId) === controller) {
        this.sessionAbortMap.delete(sessionId);
      }
    }

    handlers?.onDone?.(content);
    this.emit('agent:response', content);
    return content;
  }

  abortSession(sessionId = 'default') {
    const controller = this.sessionAbortMap.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  private isAbortError(error: unknown) {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const name = String((error as { name?: string }).name ?? '');
    return name === 'AbortError';
  }

  /**
   * 非流式一轮（invoke）。与 {@link agentRequest} 的流式路径分离；需要同步结果时调用。
   */
  async invokeAgentRequest(
    input: string,
    sessionId = 'default',
    signal?: AbortSignal
  ): Promise<string> {
    const message = input.trim();
    if (!message) {
      return '';
    }

    this.emit('agent:request', message);
    const agentConfig = {
      configurable: { thread_id: sessionId },
      signal,
      recursionLimit: this.recursionLimit,
    };
    const response = await this.agent.invoke(
      {
        messages: [new HumanMessage(message)],
      },
      agentConfig
    );
    const content = extractLastAiText(response.messages ?? []);
    this.emit('agent:response', content);
    return content;
  }

  private async runAgent(params: RunAgentParams): Promise<string> {
    const { message, threadId, streamCtx, signal } = params;

    const agentConfig = {
      configurable: { thread_id: threadId },
      signal,
      recursionLimit: this.recursionLimit,
    };

    let content = '';

    const stream = await this.agent.stream(
      {
        messages: [new HumanMessage(message)],
      },
      {
        ...agentConfig,
        streamMode: ['updates', 'messages', 'custom'],
      }
    );

    for await (const chunk of stream) {
      if (streamCtx.controller?.signal.aborted) break;
      if (!Array.isArray(chunk) || typeof chunk[0] !== 'string') continue;

      const [mode, payload] = chunk as unknown as [string, unknown];

      if (mode === 'messages') {
        const [token] = payload as unknown as [unknown, unknown];

        const thinkingDelta = extractThinkingFromToken(token);
        if (thinkingDelta) {
          this.emitStreamEvent(
            streamCtx,
            { kind: 'thinking_chunk', message: thinkingDelta },
            false
          );
        }

        const tokenContent = (token as { content?: unknown })?.content;
        const delta = typeof tokenContent === 'string' ? tokenContent : '';
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
    }

    return content;
  }

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
        if (keys.size > this.eventDedupLimit) {
          const first = keys.values().next();
          if (!first.done) keys.delete(first.value);
        }
      }
    }

    streamCtx.handlers.onEvent(event);
  }
}
