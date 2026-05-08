import { memo, useEffect, useMemo, useState } from 'react'
import ChatComposer from './components/ChatComposer'
import ChatMessageList from './components/ChatMessageList'
import WelcomePanel from './components/WelcomePanel'
import type { AgentEvent, AgentEventKind, ChatMessage } from './types'
import { getTimeText } from './utils'

interface Conversation {
  id: string
  title: string
  summary: string
  messages: ChatMessage[]
  isSending: boolean
  abortableMessageId: number | null
}

/** 历史版本曾写入 localStorage，启动时清除，不在本地保留对话记录 */
const LEGACY_STORAGE_KEY = 'agent:conversations:v1'

const Message = () => {
  const [input, setInput] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeSessionId) ?? null,
    [conversations, activeSessionId]
  )

  const updateConversation = (sessionId: string, updater: (conv: Conversation) => Conversation) => {
    setConversations((prev) =>
      prev.map((conv) => (conv.id === sessionId ? updater(conv) : conv))
    )
  }

  const createSessionId = () => `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  const createConversation = async () => {
    const id = createSessionId()
    await window.ipc.agentCreateSession(id)
    setConversations((prev) => [
      {
        id,
        title: '新对话',
        summary: '',
        messages: [],
        isSending: false,
        abortableMessageId: null
      },
      ...prev
    ])
    setActiveSessionId(id)
  }

  useEffect(() => {
    const init = async () => {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch {
        // ignore
      }

      const id = createSessionId()
      await window.ipc.agentCreateSession(id)
      setConversations([
        {
          id,
          title: '新对话',
          summary: '',
          messages: [],
          isSending: false,
          abortableMessageId: null
        }
      ])
      setActiveSessionId(id)
    }
    void init()
  }, [])

  const appendUserMessage = (sessionId: string, content: string) => {
    const nextMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content,
      time: getTimeText()
    }
    updateConversation(sessionId, (conv) => ({ ...conv, messages: [...conv.messages, nextMessage] }))
  }

  const appendAssistantMessage = (sessionId: string, content: string) => {
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
  }

  const appendAssistantChunk = (sessionId: string, id: number, chunk: string) => {
    updateConversation(sessionId, (conv) => ({
      ...conv,
      messages: conv.messages.map((item) => {
        if (item.id !== id) return item
        const prevEvents = item.events ?? []
        const last = prevEvents[prevEvents.length - 1]
        const nextEvents =
          last?.kind === 'assistant_text'
            ? [
              ...prevEvents.slice(0, -1),
              { ...last, message: `${last.message}${chunk}` }
            ]
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
  }

  /** 深度思考模式：将 thinking_chunk 增量合并到最后一个 thinking_chunk 事件 */
  const appendThinkingChunk = (sessionId: string, id: number, chunk: string) => {
    updateConversation(sessionId, (conv) => ({
      ...conv,
      messages: conv.messages.map((item) => {
        if (item.id !== id) return item
        const prevEvents = item.events ?? []
        const last = prevEvents[prevEvents.length - 1]
        const nextEvents =
          last?.kind === 'thinking_chunk'
            ? [
              ...prevEvents.slice(0, -1),
              { ...last, message: `${last.message}${chunk}` }
            ]
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
  }

  const appendAssistantEvent = (sessionId: string, id: number, event: Omit<AgentEvent, 'time'>) => {
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
  }

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

  const generateSummaryByFirstMessage = async (sessionId: string, firstMessage: string) => {
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
      updateConversation(sessionId, (conv) => ({ ...conv, title: summary, summary }))
    } catch (error) {
      console.warn('[summary] 生成失败：', error)
    }
  }

  const sendWithPrompt = async (prompt: string, clearInput = false) => {
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
      updateConversation(currentSessionId, (conv) => ({
        ...conv,
        isSending: false,
        abortableMessageId: null,
        messages: conv.messages.map((m) =>
          m.id === assistantId && m.role === 'assistant' ? { ...m, pending: false } : m
        )
      }))
    }
  }

  const sendMessage = async () => {
    await sendWithPrompt(input, true)
  }

  const abortAnswer = async () => {
    if (!activeConversation?.isSending) return
    try {
      await window.ipc.agentChatAbort(activeConversation.id)
    } finally {
      updateConversation(activeConversation.id, (conv) => ({
        ...conv,
        isSending: false,
        abortableMessageId: null,
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
                      kind: 'assistant_text',
                      message: '（已中断）',
                      time: getTimeText()
                    }
                  ]
            }
            : m
        )
      }))
    }
  }

  const removeConversation = async (sessionId: string) => {
    const target = conversations.find((item) => item.id === sessionId)
    if (!target) return
    if (target.isSending) {
      await window.ipc.agentChatAbort(sessionId)
    }
    await window.ipc.agentRemoveSession(sessionId)
    setConversations((prev) => prev.filter((item) => item.id !== sessionId))
    if (activeSessionId === sessionId) {
      const next = conversations.find((item) => item.id !== sessionId)
      if (next) {
        setActiveSessionId(next.id)
      } else {
        void createConversation()
      }
    }
  }

  return (
    <div className="flex h-screen min-h-0 gap-6 bg-white text-[#1f2328] pl-3 pr-4">
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-[#e8eaed] bg-[#f6f7f9] py-6 pl-4 pr-4">
        <button
          type="button"
          className="shrink-0 rounded-lg bg-[#334155] px-3 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#475569]"
          onClick={() => void createConversation()}
        >
          + 新建对话
        </button>
        <div className="agent-scroll mt-8 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6 pt-2">
          <ul className="flex flex-col gap-4">
            {conversations.map((item) => (
              <li key={item.id}>
                <div
                  className={`group flex items-start gap-3 rounded-xl border px-3.5 py-3.5 text-sm shadow-sm transition ${item.id === activeSessionId
                    ? 'border-[#d1d5db] bg-white'
                    : 'border-transparent bg-[#eff1f4] hover:border-[#dce0e5] hover:bg-white'
                    }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setActiveSessionId(item.id)}
                  >
                    <p className="truncate text-sm font-medium text-[#111827]">
                      {item.summary || item.title}
                    </p>
                    {item.messages.length > 0 ? (
                      <p className="mt-1.5 truncate text-xs text-[#64748b]">
                        {`${item.messages.length} 条消息`}
                      </p>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="mt-0.5 shrink-0 text-xs text-[#6b7280] opacity-0 transition group-hover:opacity-100"
                    onClick={() => void removeConversation(item.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-1">
        <main className="min-h-0 flex-1 overflow-hidden pt-6 pr-2 md:pr-4">
          {!activeConversation || activeConversation.messages.length === 0 ? (
            <WelcomePanel />
          ) : (
            <div className="mx-auto h-full max-w-3xl px-2 md:px-4">
              <ChatMessageList
                messages={activeConversation.messages}
                abortableMessageId={activeConversation.abortableMessageId}
              />
            </div>
          )}
        </main>

        <div className="shrink-0 pb-6 pt-4 pr-2 md:pr-4">
          <div className="mx-auto max-w-3xl px-2 md:px-4">
            <ChatComposer
              value={input}
              onChange={setInput}
              onSend={sendMessage}
              onAbort={abortAnswer}
              sending={Boolean(activeConversation?.isSending)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(Message)
