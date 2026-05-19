import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentConversation, AgentEvent, AgentEventKind, ChatMessage } from '../types'
import { getTimeText } from '../utils'
import {
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  getConversation as apiGetConversation,
  listConversations as apiListConversations,
  saveConversation as apiSaveConversation
} from '@renderer/api/conversation'

/** 供主进程 LangGraph 注入：仅 role + 正文（与主进程 conversationRowsToBaseMessages 输入一致） */
function messagesForAgentMain(conv: AgentConversation): Array<{ role: string; content: string }> {
  return conv.messages.map((m) => ({ role: m.role, content: m.content }))
}

export function useAgentConversations() {
  const [input, setInput] = useState('')
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeSessionId) ?? null,
    [conversations, activeSessionId]
  )

  const buildSavePayload = useCallback((conv: AgentConversation) => {
    return {
      id: conv.id,
      title: conv.summary || conv.title,
      summary: conv.summary,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        events_json: m.events
      }))
    }
  }, [])

  const saveConversationToDb = useCallback(
    async (conv: AgentConversation) => {
      try {
        const result = await apiSaveConversation(buildSavePayload(conv))
        if (!result.ok) {
          console.warn('[db] 保存对话失败：', result.error)
        }
      } catch (error) {
        console.warn('[db] 保存对话失败：', error)
      }
    },
    [buildSavePayload]
  )

  const deleteConversationFromDb = useCallback(async (sessionId: string) => {
    try {
      const result = await apiDeleteConversation(sessionId)
      if (!result.ok) {
        console.warn('[db] 删除对话失败：', result.error)
      }
    } catch (error) {
      console.warn('[db] 删除对话失败：', error)
    }
  }, [])

  const updateConversation = useCallback(
    (sessionId: string, updater: (conv: AgentConversation) => AgentConversation) => {
      setConversations((prev) => prev.map((conv) => (conv.id === sessionId ? updater(conv) : conv)))
    },
    []
  )

  const createSessionId = () => `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  /** 与主进程 {@link AgentManager.createAgent} 对齐：传入当前 UI 消息快照，主进程不查库 */
  const syncAgentOnMain = useCallback(
    (sessionId: string, messages: Array<{ role: string; content: string }>) => {
      return window.ipc.agentCreateSession(sessionId, messages)
    },
    []
  )

  const selectConversation = useCallback(
    (conv: AgentConversation) => {
      setActiveSessionId(conv.id)
      void syncAgentOnMain(conv.id, messagesForAgentMain(conv))
    },
    [syncAgentOnMain]
  )

  const createConversation = useCallback(async () => {
    const id = createSessionId()
    const now = new Date().toISOString()
    await syncAgentOnMain(id, [])
    const newConv: AgentConversation = {
      id,
      title: '新对话',
      summary: '',
      messages: [],
      isSending: false,
      abortableMessageId: null,
      updatedAt: now
    }
    setConversations((prev) => [newConv, ...prev])
    setActiveSessionId(id)
    try {
      const result = await apiCreateConversation(buildSavePayload(newConv))
      if (!result.ok) {
        console.warn('[db] 创建对话失败：', result.error)
      }
    } catch (error) {
      console.warn('[db] 创建对话失败：', error)
    }
  }, [buildSavePayload, syncAgentOnMain])

  useEffect(() => {
    const init = async () => {
      try {
        const listResult = await apiListConversations()
        if (listResult.ok && listResult.conversations && listResult.conversations.length > 0) {
          const details = await Promise.all(
            listResult.conversations.map((c) => apiGetConversation(c.id))
          )

          const loaded: AgentConversation[] = []
          for (let i = 0; i < listResult.conversations.length; i += 1) {
            const meta = listResult.conversations[i]
            const detail = details[i]
            const conv = (detail?.ok && detail.conversation) as Record<string, unknown> | undefined
            const dbMessages = (conv?.messages as Array<Record<string, unknown>> | undefined) ?? []
            const updatedAt = meta.updated_at || meta.created_at || new Date().toISOString()

            loaded.push({
              id: meta.id,
              title: meta.title,
              summary: meta.summary,
              messages: dbMessages.map((m) => ({
                id: Number(m.id),
                role: String(m.role ?? 'user') as 'user' | 'assistant',
                content: String(m.content ?? ''),
                time: getTimeText(),
                pending: false,
                events: Array.isArray(m.events_json)
                  ? (m.events_json as AgentEvent[]).map((e: AgentEvent) => ({
                      ...e,
                      time: e.time ?? getTimeText()
                    }))
                  : undefined
              })),
              isSending: false,
              abortableMessageId: null,
              updatedAt
            })
          }

          if (loaded.length > 0) {
            setConversations(loaded)
            setActiveSessionId(loaded[0].id)
            await syncAgentOnMain(loaded[0].id, messagesForAgentMain(loaded[0])).catch(() => undefined)
            return
          }
        }
      } catch (error) {
        console.warn('[db] 加载历史对话失败：', error)
      }

      const id = createSessionId()
      const now = new Date().toISOString()
      await syncAgentOnMain(id, [])
      const newConv: AgentConversation = {
        id,
        title: '新对话',
        summary: '',
        messages: [],
        isSending: false,
        abortableMessageId: null,
        updatedAt: now
      }
      setConversations([newConv])
      setActiveSessionId(id)
      try {
        const result = await apiCreateConversation(buildSavePayload(newConv))
        if (!result.ok) {
          console.warn('[db] 创建对话失败：', result.error)
        }
      } catch (error) {
        console.warn('[db] 创建对话失败：', error)
      }
    }
    void init()
  }, [buildSavePayload, syncAgentOnMain])

  const appendUserMessage = useCallback(
    (sessionId: string, content: string) => {
      const nextMessage: ChatMessage = {
        id: Date.now(),
        role: 'user',
        content,
        time: getTimeText()
      }
      const touched = new Date().toISOString()
      updateConversation(sessionId, (conv) => ({
        ...conv,
        messages: [...conv.messages, nextMessage],
        updatedAt: touched
      }))
    },
    [updateConversation]
  )

  const appendAssistantMessage = useCallback(
    (sessionId: string, content: string) => {
      const nextMessage: ChatMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content,
        time: getTimeText(),
        pending: true,
        events: []
      }
      updateConversation(sessionId, (conv) => ({
        ...conv,
        messages: [...conv.messages, nextMessage],
        abortableMessageId: nextMessage.id
      }))
      return nextMessage.id
    },
    [updateConversation]
  )

  const appendAssistantChunk = useCallback(
    (sessionId: string, id: number, chunk: string) => {
      updateConversation(sessionId, (conv) => ({
        ...conv,
        messages: conv.messages.map((item) => {
          if (item.id !== id) return item
          const prevEvents = item.events ?? []
          const last = prevEvents[prevEvents.length - 1]
          const isWhitespaceOnly = !chunk.trim()
          const nextEvents =
            last?.kind === 'assistant_text'
              ? [...prevEvents.slice(0, -1), { ...last, message: `${last.message}${chunk}` }]
              : isWhitespaceOnly
                ? prevEvents
                : [
                    ...prevEvents,
                    {
                      kind: 'assistant_text' as const,
                      message: chunk,
                      time: getTimeText()
                    }
                  ]
          return {
            ...item,
            content: `${item.content}${chunk}`,
            pending: false,
            events: nextEvents.slice(-80)
          }
        })
      }))
    },
    [updateConversation]
  )

  const appendThinkingChunk = useCallback(
    (sessionId: string, id: number, chunk: string) => {
      updateConversation(sessionId, (conv) => ({
        ...conv,
        messages: conv.messages.map((item) => {
          if (item.id !== id) return item
          const prevEvents = item.events ?? []
          const last = prevEvents[prevEvents.length - 1]
          const nextEvents =
            last?.kind === 'thinking_chunk'
              ? [...prevEvents.slice(0, -1), { ...last, message: `${last.message}${chunk}` }]
              : [
                  ...prevEvents,
                  {
                    kind: 'thinking_chunk' as const,
                    message: chunk,
                    time: getTimeText()
                  }
                ]
          return { ...item, events: nextEvents.slice(-80) }
        })
      }))
    },
    [updateConversation]
  )

  const appendAssistantEvent = useCallback(
    (sessionId: string, id: number, event: Omit<AgentEvent, 'time'>) => {
      updateConversation(sessionId, (conv) => ({
        ...conv,
        messages: conv.messages.map((item) =>
          item.id === id
            ? {
                ...item,
                events: [...(item.events ?? []), { ...event, time: getTimeText() }].slice(-80)
              }
            : item
        )
      }))
    },
    [updateConversation]
  )

  const isAgentEvent = (value: unknown): value is Omit<AgentEvent, 'time'> => {
    if (!value || typeof value !== 'object') return false
    const v = value as Record<string, unknown>
    if (typeof v.message !== 'string') return false
    if (typeof v.kind !== 'string') return false
    return true
  }

  const toEventKind = (kind: string): AgentEventKind => {
    if (
      kind === 'tool_call' ||
      kind === 'tool_result' ||
      kind === 'tool_progress' ||
      kind === 'agent_step'
    ) {
      return kind
    }
    return 'agent_step'
  }

  const generateSummaryByFirstMessage = useCallback(
    async (sessionId: string, firstMessage: string) => {
      const source = firstMessage.trim()
      if (!source) return
      if (typeof window.ipc?.agentSummarize !== 'function') {
        console.warn('[summary] window.ipc.agentSummarize 不存在，请重启 electron-vite dev 使 preload 生效')
        return
      }
      try {
        const summary = (await window.ipc.agentSummarize(source)).trim()
        if (!summary) {
          console.warn('[summary] 模型返回空摘要')
          return
        }
        const touched = new Date().toISOString()
        updateConversation(sessionId, (conv) => ({
          ...conv,
          title: summary,
          summary,
          updatedAt: touched
        }))
      } catch (error) {
        console.warn('[summary] 生成失败：', error)
      }
    },
    [updateConversation]
  )

  const sendWithPrompt = useCallback(
    async (prompt: string, clearInput = false) => {
      const currentSessionId = activeSessionId
      const currentConversation = conversations.find((item) => item.id === currentSessionId)
      const text = prompt.trim()
      if (!text || !currentConversation || currentConversation.isSending) return

      const shouldGenerateSummary =
        !currentConversation.summary &&
        currentConversation.messages.filter((item) => item.role === 'user').length === 0

      appendUserMessage(currentSessionId, text)
      if (shouldGenerateSummary) {
        void generateSummaryByFirstMessage(currentSessionId, text)
      }
      if (clearInput) {
        setInput('')
      }
      updateConversation(currentSessionId, (conv) => ({ ...conv, isSending: true }))
      const assistantId = appendAssistantMessage(currentSessionId, '')
      try {
        await window.ipc.agentChatStream(text, currentSessionId, {
          onChunk: (chunk: string) => {
            console.log('[chunk]', chunk)
            appendAssistantChunk(currentSessionId, assistantId, chunk)
          },
          onEvent: (event: unknown) => {
            if (!isAgentEvent(event)) return
            const kind = String((event as { kind: string }).kind)
            if (kind === 'thinking_chunk') {
              appendThinkingChunk(currentSessionId, assistantId, event.message)
              return
            }
            appendAssistantEvent(currentSessionId, assistantId, {
              kind: toEventKind(kind),
              tool: (event as { tool?: string }).tool,
              step: (event as { step?: string }).step,
              args: (event as { args?: unknown }).args,
              message: event.message
            })
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        appendAssistantChunk(currentSessionId, assistantId, `Agent 调用失败：${message}`)
      } finally {
        const touched = new Date().toISOString()
        updateConversation(currentSessionId, (conv) => {
          const updated: AgentConversation = {
            ...conv,
            isSending: false,
            abortableMessageId: null,
            updatedAt: touched,
            messages: conv.messages.map((m) =>
              m.id === assistantId && m.role === 'assistant' ? { ...m, pending: false } : m
            )
          }
          setTimeout(() => {
            void saveConversationToDb(updated)
          }, 0)
          return updated
        })
      }
    },
    [
      activeSessionId,
      conversations,
      appendUserMessage,
      appendAssistantMessage,
      appendAssistantChunk,
      appendThinkingChunk,
      appendAssistantEvent,
      generateSummaryByFirstMessage,
      updateConversation,
      saveConversationToDb
    ]
  )

  const sendMessage = useCallback(async () => {
    await sendWithPrompt(input, true)
  }, [sendWithPrompt, input])

  const abortAnswer = useCallback(async () => {
    if (!activeConversation?.isSending) return
    try {
      await window.ipc.agentChatAbort(activeConversation.id)
    } finally {
      const touched = new Date().toISOString()
      updateConversation(activeConversation.id, (conv) => {
        const updated: AgentConversation = {
          ...conv,
          isSending: false,
          abortableMessageId: null,
          updatedAt: touched,
          messages: conv.messages.map((m) =>
            m.role === 'assistant' && m.id === conv.abortableMessageId
              ? {
                  ...m,
                  pending: false,
                  content: m.content.trim() ? m.content : '（已中断）',
                  events:
                    m.content.trim() || (m.events?.length ?? 0) > 0
                      ? m.events
                      : [
                          ...(m.events ?? []),
                          {
                            kind: 'assistant_text' as const,
                            message: '（已中断）',
                            time: getTimeText()
                          }
                        ]
                }
              : m
          )
        }
        setTimeout(() => {
          void saveConversationToDb(updated)
        }, 0)
        return updated
      })
    }
  }, [activeConversation, updateConversation, saveConversationToDb])

  const removeConversation = useCallback(
    async (sessionId: string) => {
      const target = conversations.find((item) => item.id === sessionId)
      if (!target) return
      if (target.isSending) {
        await window.ipc.agentChatAbort(sessionId)
      }
      await window.ipc.agentRemoveSession(sessionId)
      void deleteConversationFromDb(sessionId)
      const remaining = conversations.filter((item) => item.id !== sessionId)
      setConversations(remaining)
      if (activeSessionId === sessionId) {
        const next = remaining[0]
        if (next) {
          setActiveSessionId(next.id)
          void syncAgentOnMain(next.id, messagesForAgentMain(next))
        } else {
          await createConversation()
        }
      }
    },
    [conversations, activeSessionId, deleteConversationFromDb, createConversation, syncAgentOnMain]
  )

  return {
    input,
    setInput,
    conversations,
    activeSessionId,
    activeConversation,
    selectConversation,
    createConversation,
    removeConversation,
    sendMessage,
    abortAnswer
  }
}
