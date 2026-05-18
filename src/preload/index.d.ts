import { ElectronAPI } from '@electron-toolkit/preload'

interface IpcApi {
  agentCreateSession: (
    sessionId: string,
    messages?: Array<{ role: string; content: string }>
  ) => Promise<{ sessionId: string }>
  agentRemoveSession: (sessionId: string) => Promise<{ removed: boolean }>
  agentChatStream: (
    input: string,
    sessionId: string,
    handlers: {
      onChunk?: (chunk: string) => void
      onEvent?: (event: {
        kind: string
        message: string
        tool?: string
        step?: string
        args?: unknown
      }) => void
      onDone?: (content: string) => void
      onError?: (message: string) => void
    }
  ) => Promise<string>
  agentChatAbort: (sessionId: string) => Promise<void>
  agentSummarize: (text: string) => Promise<string>
  ragPickDocumentPath: () => Promise<string | null>
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

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    ipc: IpcApi
  }
}
