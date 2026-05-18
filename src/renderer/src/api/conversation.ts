import { http } from './http'

/**
 * 对话持久化的 REST 客户端
 *
 * mysql-service 提供的端点：
 *   GET    /conversations          列出对话元数据
 *   GET    /conversations/:id      获取单条对话详情
 *   POST   /conversations          upsert 单条对话
 *   DELETE /conversations/:id      删除单条对话
 */

export interface ConversationMeta {
  id: string
  title: string
  summary: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface ListConversationsResult {
  ok: boolean
  conversations?: ConversationMeta[]
  error?: string
}

export interface GetConversationResult {
  ok: boolean
  conversation?: unknown
  error?: string
}

export interface SimpleResult {
  ok: boolean
  error?: string
}

/** 将 axios 错误统一转为 { ok: false, error } 形态，与原 IPC 协议对齐 */
const toErrorResult = (error: unknown): SimpleResult => {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}

export const listConversations = async (): Promise<ListConversationsResult> => {
  try {
    const { data } = await http.get<ListConversationsResult>('/conversations')
    return data
  } catch (error) {
    return toErrorResult(error)
  }
}

export const getConversation = async (id: string): Promise<GetConversationResult> => {
  try {
    const { data } = await http.get<GetConversationResult>(
      `/conversations/${encodeURIComponent(id)}`
    )
    return data
  } catch (error) {
    return toErrorResult(error)
  }
}

export const saveConversation = async (
  payload: Record<string, unknown>
): Promise<SimpleResult> => {
  try {
    const { data } = await http.post<SimpleResult>('/conversations', payload)
    return data
  } catch (error) {
    return toErrorResult(error)
  }
}

/**
 * 创建新对话
 *
 * 后端 POST /conversations 为 upsert 语义，已存在相同 id 时会更新。
 * 前端单独封装 createConversation 方便调用方表达语义：
 * 仅用于“新建空对话”场景，避免误用为覆盖保存。
 */
export const createConversation = async (
  payload: Record<string, unknown>
): Promise<SimpleResult> => {
  try {
    const { data } = await http.post<SimpleResult>('/conversations', payload)
    return data
  } catch (error) {
    return toErrorResult(error)
  }
}

export const deleteConversation = async (id: string): Promise<SimpleResult> => {
  try {
    const { data } = await http.delete<SimpleResult>(
      `/conversations/${encodeURIComponent(id)}`
    )
    return data
  } catch (error) {
    return toErrorResult(error)
  }
}
