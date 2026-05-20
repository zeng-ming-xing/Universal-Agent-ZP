/**
 * 主图组装：标准 ReAct 式 agent ↔ 工具循环。
 *
 * 流程：
 *   START → agent → [tools | END]
 *   tools → agent
 *
 * query_database 与其他工具一样在 ToolNode 内执行，无特殊路由。
 */
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import {
  END,
  MessagesValue,
  START,
  StateSchema,
  StateGraph,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { createModel } from '../../../agent/model';
import type { AgentManager } from '../../index';
import { createAgentGraphTools } from '../../tools/index';
import {
  createCallModelNode,
} from './nodes/call-model';
import { routeAfterAgent } from './routing';

export type BuildMainGraphOptions = {
  getManager: () => AgentManager;
};

export function buildMainGraph(options: BuildMainGraphOptions) {
  const { getManager } = options;

  const tools = createAgentGraphTools(getManager);
  // #region agent log
  fetch('http://127.0.0.1:7308/ingest/9df0043a-1e2b-4de5-81a0-594b047d82f3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ff925'},body:JSON.stringify({sessionId:'8ff925',runId:'pre-fix',hypothesisId:'H2',location:'graph/main/index.ts:buildMainGraph',message:'graph tools created',data:{toolCount:tools.length,toolNames:tools.map((t)=>t.name)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const model = createModel({
    temperature: 0.4,
    maxTokens: 8192,
  });

  const MainState = new StateSchema({
    messages: MessagesValue,
  });

  const callModel = createCallModelNode(model, tools, getManager);
  const toolNode = new ToolNode(tools);

  const workflow = new StateGraph(MainState)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent, ['tools', END])
    .addEdge('tools', 'agent');

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

export type CompiledMainGraph = ReturnType<typeof buildMainGraph>;
