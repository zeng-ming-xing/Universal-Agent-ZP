/// <reference types="vite/client" />
type AgentStreamEvent = {
  kind: string
  message: string
  tool?: string
  step?: string
  args?: unknown
}

interface AppElectronAPI {
  agentCreateSession: (sessionId: string) => Promise<{ sessionId: string }>
  agentRemoveSession: (sessionId: string) => Promise<{ removed: boolean }>
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
  agentChatAbort: (sessionId: string) => Promise<void>
  agentSummarize: (text: string) => Promise<string>
}

declare global {
  interface Window {
    ipc: AppElectronAPI
  }
}
export {};