import { ipcMain } from 'electron'
import { AgentManager } from '../managers/agent-manager'
import { summarizeFirstMessage } from '../agent/model'

export const bindAgentIpc = (agentManager: AgentManager): void => {
  ipcMain.handle('agent:create-session', (_event, payload?: { sessionId?: string }) => {
    const nextSessionId = payload?.sessionId?.trim()
    if (!nextSessionId) {
      throw new Error('sessionId is required')
    }
    agentManager.createAgent(nextSessionId)
    return { sessionId: nextSessionId }
  })

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
      void agent
        .chatStream(input, sessionId, {
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
    const agent = agentManager.getAgent(nextSessionId)
    agent.abortSession(nextSessionId)
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
}
