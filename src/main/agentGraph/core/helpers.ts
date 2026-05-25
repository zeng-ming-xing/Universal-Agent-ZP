import {
  extractThinkingFromToken,
  getEventDedupKey,
  tryParseCustomEvent,
} from '../../agent/core/helpers';
import type { AgentFrontendEvent, StreamContext } from './types';

export {
  extractThinkingFromToken,
  getEventDedupKey,
  tryParseCustomEvent,
};

const eventDedupLimit = Number(process.env.AGENT_EVENT_DEDUP_LIMIT) || 200;

export function getIncrementalText(previous: string, current: string): string {
  if (!current) return '';
  if (!previous) return current;
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }
  if (previous.startsWith(current)) {
    return '';
  }
  const maxOverlap = Math.min(previous.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === current.slice(0, overlap)) {
      return current.slice(overlap);
    }
  }
  return current;
}

export function emitStreamEvent(
  streamCtx: StreamContext | undefined,
  event: AgentFrontendEvent,
  dedup = false
) {
  if (!streamCtx?.handlers?.onEvent) return;
  if (!event.message?.trim()) return;

  if (dedup) {
    const key = getEventDedupKey(event);
    const keys = streamCtx.eventDedupKeys;
    if (keys) {
      if (keys.has(key)) return;
      keys.add(key);
      if (keys.size > eventDedupLimit) {
        const first = keys.values().next();
        if (!first.done) keys.delete(first.value);
      }
    }
  }

  streamCtx.handlers.onEvent(event);
}

export async function processAgentStreamChunk(
  chunk: unknown,
  streamCtx: StreamContext,
  onContent: (delta: string) => void
): Promise<void> {
  let mode: string | undefined;
  let payload: unknown;
  if (Array.isArray(chunk) && typeof chunk[0] === 'string') {
    // 多 streamMode 时，LangGraph.js 返回 [mode, payload]
    [mode, payload] = chunk as [string, unknown];
  } else if (chunk && typeof chunk === 'object') {
    // stream version v2 兼容：{ type, data, ns }
    const part = chunk as { type?: unknown; data?: unknown };
    if (typeof part.type === 'string') {
      mode = part.type;
      payload = part.data;
    }
  }
  if (!mode) return;

  if (mode === 'messages') {
    const token = Array.isArray(payload) ? payload[0] : payload;
    const metadata = Array.isArray(payload) ? payload[1] : undefined;
    if (!token || typeof token !== 'object') return;
    if (metadata && typeof metadata === 'object') {
      const nodeName = (metadata as { langgraph_node?: unknown }).langgraph_node;
      const allowlist = streamCtx.messageNodesAllowlist;
      if (allowlist?.size && typeof nodeName === 'string' && !allowlist.has(nodeName)) {
        return;
      }
    }

    const rawThinking = extractThinkingFromToken(token);
    if (rawThinking) {
      const thinkingDelta = getIncrementalText(
        streamCtx.lastThinkingText ?? '',
        rawThinking
      );
      streamCtx.lastThinkingText = rawThinking;
      if (thinkingDelta) {
        emitStreamEvent(
          streamCtx,
          { kind: 'thinking_chunk', message: thinkingDelta },
          false
        );
      }
    }

    const tok = token as {
      tool_calls?: unknown[];
      invalid_tool_calls?: unknown[];
      tool_call_chunks?: unknown[];
      type?: string;
    };
    if (
      (tok.tool_call_chunks?.length ?? 0) > 0 ||
      (tok.invalid_tool_calls?.length ?? 0) > 0 ||
      (tok.tool_calls?.length ?? 0) > 0
    ) {
      // #region agent log
      fetch('http://127.0.0.1:7308/ingest/9df0043a-1e2b-4de5-81a0-594b047d82f3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ff925'},body:JSON.stringify({sessionId:'8ff925',hypothesisId:'H1',location:'helpers.ts:messages-chunk',message:'stream token has tool fields',data:{node:(metadata as {langgraph_node?:string})?.langgraph_node,tokenType:tok.type,toolCallsLen:tok.tool_calls?.length??0,invalidLen:tok.invalid_tool_calls?.length??0,chunksLen:tok.tool_call_chunks?.length??0,invalid:tok.invalid_tool_calls,chunks:tok.tool_call_chunks},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }

    const tokenContent = (token as { content?: unknown })?.content;
    const rawContent =
      typeof tokenContent === 'string'
        ? tokenContent
        : Array.isArray(tokenContent)
          ? tokenContent
              .map((item) =>
                typeof item === 'string'
                  ? item
                  : ((item as { text?: unknown })?.text ?? '')
              )
              .join('')
          : '';
    const delta = getIncrementalText(streamCtx.lastContentText ?? '', rawContent);
    streamCtx.lastContentText = rawContent || streamCtx.lastContentText || '';
    if (delta) onContent(delta);
    return;
  }

  if (mode === 'custom') {
    const evt = tryParseCustomEvent(payload);
    if (evt) emitStreamEvent(streamCtx, evt, true);
  }
}
