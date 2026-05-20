import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';

/** 主图路由函数共用的 messages 切片状态 */
export type MainGraphMessagesState = {
  messages: BaseMessage[];
};

/** agent 输出 tool_calls? → tools; 否则 → END */
export function routeAfterAgent(
  state: MainGraphMessagesState
): 'tools' | typeof END {
  const last = state.messages.at(-1);
  if (!AIMessage.isInstance(last)) {
    return END;
  }
  const toolCalls = last.tool_calls;
  const invalid = (last as { invalid_tool_calls?: unknown[] }).invalid_tool_calls;
  const target = toolCalls?.length ? 'tools' : 'END';
  // #region agent log
  fetch('http://127.0.0.1:7308/ingest/9df0043a-1e2b-4de5-81a0-594b047d82f3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ff925'},body:JSON.stringify({sessionId:'8ff925',runId:'pre-fix',hypothesisId:'H4',location:'graph/main/routing.ts:routeAfterAgent',message:'route decision by tool calls',data:{target,toolCallsLen:toolCalls?.length??0,invalidLen:invalid?.length??0,toolCalls,invalid},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!toolCalls?.length) {
    return END;
  }
  return 'tools';
}
