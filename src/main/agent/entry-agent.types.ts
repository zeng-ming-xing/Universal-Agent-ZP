import type { BaseMessage } from '@langchain/core/messages';

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
  rawToolJsonState: { active: boolean; braceDepth: number };
  controller?: AbortController;
  eventDedupKeys?: Set<string>;
};

export type RunLoopParams = {
  message: string;
  history: BaseMessage[];
  streamCtx?: StreamContext;
  signal?: AbortSignal;
};
