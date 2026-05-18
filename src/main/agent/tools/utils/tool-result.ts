/**
 * 统一工具返回格式。
 *
 * 所有工具必须通过此模块构造 ToolMessage 返回值，确保模型能正确区分
 * "工具数据"与"自然语言输出"，避免将工具返回内容直接透传给用户。
 *
 * 使用 LangChain 原生 ToolMessage 类型，模型天然能识别其为工具响应。
 * content 统一为 JSON：{"ok":true,"summary":"简短摘要","data":{...}}
 *
 * 字段说明：
 * - ok: 工具执行成功/失败
 * - summary: 面向模型的一句话摘要（中文），帮助模型快速理解结果
 * - data: 结构化的实际数据，仅供模型推理使用，禁止直接输出
 */

import { ToolMessage } from '@langchain/core/messages';

export interface ToolResultData<T = unknown> {
  ok: boolean;
  summary: string;
  data: T;
}

/**
 * 创建统一的 ToolMessage 实例。
 * - content: { ok, summary, data } JSON 字符串
 * - name: 工具名（帮助模型识别来源）
 * - tool_call_id: LangChain 分配的唯一调用 ID
 */
export function createToolResultMessage<T = unknown>(
  tool_call_id: string,
  toolName: string,
  ok: boolean,
  summary: string,
  data: T,
): ToolMessage {
  const body: ToolResultData<T> = { ok, summary, data };
  return new ToolMessage({
    content: JSON.stringify(body),
    tool_call_id,
    name: toolName,
  });
}

/**
 * 快捷方法：成功结果。
 */
export function okToolMessage<T = unknown>(
  tool_call_id: string,
  toolName: string,
  summary: string,
  data: T,
): ToolMessage {
  return createToolResultMessage(tool_call_id, toolName, true, summary, data);
}

/**
 * 快捷方法：失败结果。
 */
export function failToolMessage<T = unknown>(
  tool_call_id: string,
  toolName: string,
  summary: string,
  data?: T,
): ToolMessage {
  return createToolResultMessage(
    tool_call_id,
    toolName,
    false,
    summary,
    (data ?? null) as T,
  );
}
