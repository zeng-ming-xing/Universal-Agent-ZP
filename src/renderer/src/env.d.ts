/// <reference types="vite/client" />

/**
 * 环境类型声明
 *
 * 定义主进程通过 preload（contextBridge）暴露给渲染进程的 API 类型。
 * 所有跨进程调用都通过 window.ipc 发起，对应的实现在 src/main/ipc/ 下。
 */

/** Agent 流式事件：主进程通过 onEvent 回调推送给 renderer 的原始事件结构 */
type AgentStreamEvent = {
  kind: string
  message: string
  tool?: string
  step?: string
  args?: unknown
}

/** 主进程 ↔ 渲染进程 IPC 接口（通过 preload 桥接） */
interface AppElectronAPI {
  /** 在主进程创建/重建 Agent 会话，并注入渲染进程传入的消息（不查库）；`messages` 缺省为空数组表示新对话 */
  agentCreateSession: (
    sessionId: string,
    messages?: Array<{ role: string; content: string }>
  ) => Promise<{ sessionId: string }>
  /** 从主进程移除 Agent 会话 */
  agentRemoveSession: (sessionId: string) => Promise<{ removed: boolean }>
  /** 发起流式对话请求，通过回调接收增量文本与事件 */
  agentChatStream: (
    input: string,
    sessionId: string,
    handlers: {
      onChunk?: (chunk: string) => void
      onEvent?: (event: AgentStreamEvent) => void
      onDone?: (content: string) => void
      onError?: (message: string) => void
    }
  ) => Promise<string>
  /** 中止当前正在进行的流式回答 */
  agentChatAbort: (sessionId: string) => Promise<void>
  /** 根据首条用户消息生成对话摘要 */
  agentSummarize: (text: string) => Promise<string>
  /** 选择本地文档路径 */
  ragPickDocumentPath: () => Promise<string | null>
  /** RAG 入库：切片、摘要、MySQL、向量库 */
  ragUploadDocument: (
    filePath: string,
    handlers?: {
      onProgress?: (p: {
        stage: string
        message: string
        current?: number
        total?: number
      }) => void
    }
  ) => Promise<
    | { ok: true; documentId: string; title: string; chunkCount: number; summary: string }
    | { ok: false; error: string }
  >
}

/** 扩展全局 Window 接口，使得 TypeScript 识别 window.ipc */
declare global {
  interface Window {
    ipc: AppElectronAPI
  }
}
export {};