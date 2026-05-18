export type Role = 'user' | 'assistant';

export type AgentEventKind =
  | 'tool_call'
  | 'tool_result'
  | 'tool_progress'
  | 'agent_step'
  | 'assistant_text'
  /** 深度思考模式：模型推理过程的增量文本 */
  | 'thinking_chunk';

export interface AgentEvent {
  kind: AgentEventKind;
  tool?: string;
  message: string;
  step?: string;
  args?: unknown;
  time: string;
}

export interface ChatMessage {
  id: number;
  role: Role;
  content: string;
  time: string;
  /** 助手：首字节到达前为 true，用于「思考中」占位 */
  pending?: boolean;
  /** Agent 工具/步骤事件（仅助手消息会有） */
  events?: AgentEvent[];
}

/** 单次对话的完整状态（含侧栏展示与流式控制） */
export interface AgentConversation {
  id: string;
  title: string;
  summary: string;
  messages: ChatMessage[];
  isSending: boolean;
  abortableMessageId: number | null;
  /** ISO 8601，用于侧栏相对时间 */
  updatedAt: string;
}
