import type { AgentFrontendEvent } from './entry-agent.types';

const TOOL_FRONTEND_VISIBILITY: Record<string, boolean> = {
  get_table_schema: false,
};

export function shouldEmitToolEventToFrontend(toolName?: string): boolean {
  if (!toolName) return true;
  return TOOL_FRONTEND_VISIBILITY[toolName] ?? true;
}

/**
 * 去除模型输出中可能包裹 JSON 的 markdown 代码块（```json ... ```）。
 * 用于解析路由器、SQL 校验器等模型的纯 JSON 输出。
 */
export function unwrapJsonText(text: string): string {
  const normalized = text.trim();
  if (!normalized.startsWith('```')) {
    return normalized;
  }
  return normalized
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

/**
 * 将 stream custom 事件的 payload 解析为 AgentFrontendEvent。
 * 支持对象直接传入和 JSON 字符串两种形式。
 */
export function tryParseCustomEvent(
  payload: unknown
): AgentFrontendEvent | null {
  if (payload && typeof payload === 'object' && 'kind' in payload) {
    const typed = payload as AgentFrontendEvent;
    if (typeof typed.kind === 'string' && typeof typed.message === 'string') {
      return typed;
    }
  }
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as AgentFrontendEvent;
      if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
        return parsed;
      }
    } catch {
      // 不是合法 JSON，当作纯文本进度消息处理
    }
    return {
      kind: 'agent_step',
      step: 'custom',
      message: payload,
    };
  }
  return null;
}

/**
 * 从 LangChain 消息的 content 字段中提取纯文本。
 * content 可能是字符串或包含 { text } 的数组（多模态格式）。
 */
export function readMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) =>
      typeof item === 'string' ? item : (item as { text?: string })?.text ?? ''
    )
    .join('');
}

/**
 * 为已知工具生成人类可读的结果摘要。
 * 用于在前端展示工具返回的简洁状态信息，而非原始 JSON。
 */
export function tryBuildToolResultSummary(
  toolName: string,
  content: unknown
): string | null {
  const raw = readMessageText(content).trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  if (toolName === 'web_search') {
    // web_search 返回文本摘要，直接截取前 100 字
    const text =
      typeof (parsed as { text?: unknown }).text === 'string'
        ? ((parsed as { text: string }).text as string).slice(0, 100)
        : raw.slice(0, 100);
    return `联网搜索完成：${text}…`;
  }

  return null;
}

/**
 * 过滤掉 LLM 流式输出中工具调用返回的原始 JSON 片段（以 {"ok": 开头的响应体）。
 * 防止工具响应 JSON 被误当作用户可见文本推送给前端。
 *
 * 使用有状态的括号深度追踪，支持跨 token 的流式拼接。
 */
export function stripRawToolJson(
  text: string,
  state: { active: boolean; braceDepth: number }
): string {
  if (!text) return '';

  let output = '';
  let index = 0;

  while (index < text.length) {
    if (!state.active) {
      const start = text.indexOf('{"ok":', index);
      if (start < 0) {
        output += text.slice(index);
        break;
      }
      output += text.slice(index, start);
      state.active = true;
      state.braceDepth = 0;
      index = start;
      continue;
    }
    const ch = text[index];
    if (ch === '{') {
      state.braceDepth += 1;
    } else if (ch === '}') {
      state.braceDepth = Math.max(0, state.braceDepth - 1);
      if (state.braceDepth === 0) {
        state.active = false;
      }
    }
    index += 1;
  }

  return output;
}

/**
 * 从 LangGraph 流式 token 对象中提取深度思考内容增量（reasoning_content）。
 * 兼容两种格式：
 *  - ZhipuAI / GLM 系列：additional_kwargs.reasoning_content（字符串）
 *  - Anthropic-style contentBlocks：type === 'thinking'（预留兼容）
 */
export function extractThinkingFromToken(token: unknown): string {
  if (!token || typeof token !== 'object') return '';

  const tokenObj = token as {
    contentBlocks?: Array<{ type?: string; text?: string; thinking?: string }>;
    additional_kwargs?: { reasoning_content?: string };
  };

  // Zhipu / GLM：增量通常在 additional_kwargs.reasoning_content，须优先于 contentBlocks，
  // 否则与「思考类」块一起 join 时容易出现同句重复。
  if (typeof tokenObj.additional_kwargs?.reasoning_content === 'string') {
    return tokenObj.additional_kwargs.reasoning_content;
  }

  // Anthropic / Claude-style contentBlocks（预留兼容）
  if (Array.isArray(tokenObj.contentBlocks)) {
    const thinking = tokenObj.contentBlocks
      .filter(
        (item) => item?.type === 'thinking' && (item.thinking || item.text)
      )
      .map((item) => item.thinking ?? item.text ?? '')
      .join('');
    if (thinking) return thinking;
  }

  return '';
}

/**
 * 从 LangGraph 流式 token 对象中提取对用户可见的正文增量（不含 reasoning / tool JSON）。
 *
 * 注意：AIMessageChunk 上访问 contentBlocks 会走标准化归一化，部分厂商流式下可能对同一
 * 增量生成多块 text，join 后出现「字字重复」。因此必须先读原生 content，最后再 fallback
 * 到 contentBlocks（仅兼容无 content、只有块的形态）。
 */
export function extractTextFromToken(token: unknown): string {
  if (!token || typeof token !== 'object') return '';

  const tokenObj = token as {
    contentBlocks?: Array<{ type?: string; text?: string }>;
    content?: unknown;
  };

  if (typeof tokenObj.content === 'string') {
    return tokenObj.content;
  }
  if (Array.isArray(tokenObj.content)) {
    return readMessageText(tokenObj.content);
  }
  if (Array.isArray(tokenObj.contentBlocks)) {
    return tokenObj.contentBlocks
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text ?? '')
      .join('');
  }
  return '';
}

/**
 * 生成前端事件的去重 key（用于 emitStreamEvent dedup 逻辑）。
 * key 由 kind / step / tool / message 四个字段拼接，保证同一事件不重复发送。
 */
export function getEventDedupKey(event: AgentFrontendEvent): string {
  const step =
    'step' in event && typeof event.step === 'string' ? event.step : '';
  const tool =
    'tool' in event && typeof event.tool === 'string' ? event.tool : '';
  return `${event.kind}|${step}|${tool}|${event.message}`;
}
