import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

type AgentStreamEvent = {
  kind: string
  message: string
  tool?: string
  step?: string
  args?: unknown
}

type RagUploadProgress = {
  stage: string
  message: string
  current?: number
  total?: number
}


// Custom APIs for renderer
const ipc = {
  agentCreateSession: async (
    sessionId: string,
    messages?: Array<{ role: string; content: string }>
  ) => {
    return await ipcRenderer.invoke('agent:create-session', {
      sessionId,
      messages: messages ?? []
    });
  },
  agentRemoveSession: async (sessionId: string) => {
    return await ipcRenderer.invoke('agent:remove-session', { sessionId });
  },
  agentChatStream: async (
    input: string,
    sessionId: string,
    handlers: {
      onChunk?: (chunk: string) => void;
      onEvent?: (event: AgentStreamEvent) => void;
      onDone?: (content: string) => void;
      onError?: (message: string) => void;
    }
  ) => {
    const requestId = `stream_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    return await new Promise<string>((resolve, reject) => {
      const listener = (
        _event: IpcRendererEvent,
        data: {
          requestId: string;
          chunk?: string;
          event?: AgentStreamEvent;
          done?: boolean;
          content?: string;
          error?: string;
        }
      ) => {
        if (!data || data.requestId !== requestId) {
          return;
        }
        if (data.error) {
          ipcRenderer.removeListener('agent:chat-stream', listener);
          handlers?.onError?.(data.error);
          reject(new Error(data.error));
          return;
        }
        if (data.chunk) {
          handlers?.onChunk?.(data.chunk);
        }
        if (data.event) {
          handlers?.onEvent?.(data.event);
        }
        if (data.done) {
          ipcRenderer.removeListener('agent:chat-stream', listener);
          const content = data.content ?? '';
          handlers?.onDone?.(content);
          resolve(content);
        }
      };

      ipcRenderer.on('agent:chat-stream', listener);
      ipcRenderer.send('agent:chat-stream', {
        requestId,
        input,
        sessionId,
      });
    });
  },
  /** 中断当前 session 的流式回答 */
  agentChatAbort: async (sessionId: string) => {
    ipcRenderer.send('agent:chat-abort', { sessionId });
  },
  /** 基于用户第一条消息生成会话摘要标题（一次性 invoke，不走 Agent） */
  agentSummarize: async (text: string): Promise<string> => {
    const result = (await ipcRenderer.invoke('agent:summarize', { text })) as {
      summary?: string;
      error?: string;
    };
    if (result?.error) {
      throw new Error(result.error);
    }
    return result?.summary ?? '';
  },
  ragPickDocumentPath: async (): Promise<string | null> => {
    const r = (await ipcRenderer.invoke('rag:pick-document-path')) as { path?: string | null };
    const p = r?.path;
    return typeof p === 'string' && p.trim() ? p.trim() : null;
  },
  ragUploadDocument: async (
    filePath: string,
    handlers?: { onProgress?: (p: RagUploadProgress) => void }
  ) => {
    const listener = (_event: IpcRendererEvent, data: RagUploadProgress) => {
      handlers?.onProgress?.(data)
    }
    ipcRenderer.on('rag:upload-progress', listener)
    try {
      return (await ipcRenderer.invoke('rag:upload-document', {
        filePath
      })) as
        | { ok: true; documentId: string; title: string; chunkCount: number; summary: string }
        | { ok: false; error: string }
    } finally {
      ipcRenderer.removeListener('rag:upload-progress', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
try {
  contextBridge.exposeInMainWorld('ipc', ipc)
} catch (error) {
  console.error(error)
}
