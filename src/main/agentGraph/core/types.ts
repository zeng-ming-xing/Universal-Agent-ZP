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
      kind: 'thinking_chunk';
      message: string;
    };

export type StreamContext = {
  handlers?: StreamHandlers;
  controller?: AbortController;
  eventDedupKeys?: Set<string>;
  lastThinkingText?: string;
  lastContentText?: string;
  messageNodesAllowlist?: Set<string>;
};

export type RunAgentParams = {
  message: string;
  threadId: string;
  streamCtx: StreamContext;
  signal?: AbortSignal;
};
