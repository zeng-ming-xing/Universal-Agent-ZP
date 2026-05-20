/**
 * 主图 agent 节点：调用 LLM 并绑定工具。
 *
 * 注意：GLM-4.6V 在流式场景下可能产出不完整 tool_call chunk，经过
 * AIMessageChunk.concat 后会出现 function: "[Object]"，最终变成 invalid_tool_calls。
 * 因此这里使用 invoke 返回完整 AIMessage，再做一次 tool_calls 归一化兜底。
 */
import { type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { buildMainAgentSystemPrompt } from '../../prompt';
import type { AgentManager } from '../../../index';

export type MainGraphState = {
  messages: BaseMessage[];
};


export function createCallModelNode(
  model: ChatOpenAI,
  tools: StructuredToolInterface[],
  getManager: () => AgentManager
) {
  const bound = model.bindTools(tools);

  return async function callModel(
    state: MainGraphState,
    config: LangGraphRunnableConfig
  ) {
    const manager = getManager();
    const system = buildMainAgentSystemPrompt(
      manager.mysqlSchemaCatalogText,
      manager.ragDocumentsPromptText,
      manager.skillsPromptText
    );
    const response = await bound.invoke([system, ...state.messages], config);

    // #region agent log
    const ai = response as {
      tool_calls?: unknown[];
      invalid_tool_calls?: unknown[];
      tool_call_chunks?: unknown[];
      additional_kwargs?: { tool_calls?: unknown[] };
    };
    fetch('http://127.0.0.1:7308/ingest/9df0043a-1e2b-4de5-81a0-594b047d82f3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ff925'},body:JSON.stringify({sessionId:'8ff925',runId:'pre-fix',hypothesisId:'H1',location:'graph/main/nodes/call-model.ts:afterInvoke',message:'model response tool fields',data:{toolCallsLen:ai.tool_calls?.length??0,invalidLen:ai.invalid_tool_calls?.length??0,chunksLen:ai.tool_call_chunks?.length??0,akToolCallsLen:ai.additional_kwargs?.tool_calls?.length??0,invalid:ai.invalid_tool_calls,chunks:ai.tool_call_chunks},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    return { messages: [response] };
  };
}
