import { BrowserWindow, dialog, ipcMain } from 'electron'

import { summarizeFirstMessage } from '../agent/model/utils/summary'
import type { AgentManagerLike } from '../agentGraph'
import { ragOperator, type RagIngestProgress } from '../rag'

export const bindAgentIpc = (agentManager: AgentManagerLike): void => {
  ipcMain.handle(
    'agent:create-session',
    async (
      _event,
      payload?: {
        sessionId?: string
        /** 渲染进程当前会话消息（role + content），主进程只据此注入 LangGraph，不查库 */
        messages?: Array<{ role?: string; content?: string }>
      }
    ) => {
      const nextSessionId = payload?.sessionId?.trim()
      if (!nextSessionId) {
        throw new Error('sessionId is required')
      }
      const messages = Array.isArray(payload?.messages) ? payload!.messages! : []
      await agentManager.createAgent(nextSessionId, messages)
      return { sessionId: nextSessionId }
    }
  )

  ipcMain.handle('agent:remove-session', (_event, payload?: { sessionId?: string }) => {
    const nextSessionId = payload?.sessionId?.trim()
    if (!nextSessionId) {
      throw new Error('sessionId is required')
    }
    return { removed: agentManager.removeAgent(nextSessionId) }
  })

  ipcMain.on(
    'agent:chat-stream',
    (
      event,
      payload?: {
        requestId?: string
        input?: string
        sessionId?: string
      }
    ) => {
      const requestId = payload?.requestId?.trim()
      const input = payload?.input?.trim()
      const sessionId = payload?.sessionId?.trim()
      if (!requestId || !input || !sessionId) {
        event.sender.send('agent:chat-stream', {
          requestId,
          error: 'invalid stream payload'
        })
        return
      }

      const agent = agentManager.getAgent(sessionId)
      if (!agent) {
        event.sender.send('agent:chat-stream', {
          requestId,
          error: '会话未就绪，请先选中该对话'
        })
        return
      }
      void agent
        .agentRequest(input, sessionId, {
          onChunk: (chunk) => {
            event.sender.send('agent:chat-stream', { requestId, chunk })
          },
          onEvent: (agentEvent) => {
            event.sender.send('agent:chat-stream', { requestId, event: agentEvent })
          },
          onDone: (content) => {
            event.sender.send('agent:chat-stream', {
              requestId,
              done: true,
              content
            })
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          event.sender.send('agent:chat-stream', { requestId, error: message })
        })
    }
  )

  ipcMain.on('agent:chat-abort', (_event, payload?: { sessionId?: string }) => {
    const nextSessionId = payload?.sessionId?.trim()
    if (!nextSessionId) {
      return
    }
    agentManager.getAgent(nextSessionId)?.abortSession(nextSessionId)
  })

  ipcMain.handle(
    'agent:summarize',
    async (_event, payload?: { text?: string }) => {
      const text = payload?.text?.trim()
      if (!text) {
        return { summary: '' }
      }
      try {
        const summary = await summarizeFirstMessage(text)
        return { summary }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { summary: '', error: message }
      }
    }
  )

  ipcMain.handle('rag:pick-document-path', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: '选择知识文档',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt'] }]
    }
    const { canceled, filePaths } =
      win != null ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (canceled || !filePaths?.[0]) {
      return { path: null as string | null }
    }
    return { path: filePaths[0] }
  })

  ipcMain.handle(
    'rag:upload-document',
    async (event, payload?: { filePath?: string }) => {
      const filePath = payload?.filePath?.trim()
      if (!filePath) {
        return { ok: false as const, error: 'filePath 不能为空' }
      }

      const sender = event.sender
      const onProgress = (data: RagIngestProgress) => {
        if (!sender.isDestroyed()) {
          sender.send('rag:upload-progress', data)
        }
      }

      ragOperator.on('progress', onProgress)
      try {
        const result = await ragOperator.ingestLocalDocument(filePath)
        void agentManager.loadRagDocumentSummaries()
        return { ok: true as const, ...result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, error: message }
      } finally {
        ragOperator.off('progress', onProgress)
      }
    }
  )
}
