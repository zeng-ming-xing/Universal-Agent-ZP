export type StreamHandlers = {
  onChunk?: (chunk: string) => void;
  onEvent?: (event: AgentFrontendEvent) => void;
  onDone?: (content: string) => void;
};

export type AgentFrontendEvent =
  | {
      kind: 'tool_call';
      tool: string;
      message: string;
      args?: unknown;
    }
  | {
      kind: 'tool_result';
      tool: string;
      message: string;
    }
  | {
      kind: 'tool_progress';
      tool: string;
      message: string;
    }
  | {
      kind: 'agent_step';
      step: string;
      message: string;
    }
  | {
      /** 深度思考模式：推理过程增量片段（reasoning_content） */
      kind: 'thinking_chunk';
      message: string;
    };

export type StreamContext = {
  handlers?: StreamHandlers;
  controller?: AbortController;
  eventDedupKeys?: Set<string>;
};

/** {@link Agent.runAgent} 流式一轮参数 */
export type RunAgentParams = {
  message: string;
  /** LangGraph checkpointer 使用的 thread_id，对应前端 sessionId */
  threadId: string;
  streamCtx: StreamContext;
  signal?: AbortSignal;
};
