import type { ToolRuntime } from 'langchain';

/** 向工具前端推送进度/结果事件 */
export function emitToolEvent(
  runtime: ToolRuntime,
  event: {
    kind: 'tool_progress' | 'tool_result';
    tool: string;
    message: string;
  }
) {
  runtime.writer?.(JSON.stringify(event));
}
