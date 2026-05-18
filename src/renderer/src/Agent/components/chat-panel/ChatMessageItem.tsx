/**
 * 单条消息条目
 * 区分用户/助手角色布局，按事件列表渲染 thinking_chunk / tool_call / assistant_text 等
 */
import { memo, useState } from 'react'
import type { AgentEvent, ChatMessage } from '../../types'
import MessageUser from './MessageUser'
import ThinkingIndicator from './ThinkingIndicator'
import MarkdownRenderer from './MarkdownRenderer'

interface ChatMessageItemProps {
  message: ChatMessage
  showAbort?: boolean
}

interface DeepThinkingSectionProps {
  text: string
  isStreaming: boolean
}

const DeepThinkingSection = memo(({ text, isStreaming }: DeepThinkingSectionProps) => {
  const [collapsed, setCollapsed] = useState(true)

  const hasText = Boolean(text)
  const expanded = !collapsed && hasText

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex select-none items-center gap-1.5 bg-transparent py-0.5 text-[#94a3b8] hover:text-[#64748b]"
      >
        <span
          className={`text-[11px] font-medium uppercase tracking-wider ${isStreaming ? 'animate-pulse' : ''}`}
        >
          thinking
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-2.5 w-2.5 transition-transform duration-300 ease-out ${collapsed ? '-rotate-90' : 'rotate-0'}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity,margin-top] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${expanded ? 'mt-1 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="agent-scroll max-h-[150px] overflow-y-auto overflow-x-hidden">
            <div className="border-l border-[#e2e8f0] pl-3 pr-2 text-[#64748b]">
              <MarkdownRenderer
                content={text}
                className="prose prose-xs prose-headings:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-pre:text-inherit prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-transparent prose-pre:px-0 prose-pre:py-0 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 max-w-none break-words italic leading-[1.65] text-inherit"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

const ChatMessageItem = ({ message, showAbort }: ChatMessageItemProps) => {
  const isUser = message.role === 'user'

  const allEvents: AgentEvent[] = message.events ?? []
  const isStreaming = Boolean(showAbort)

  const waitingFirstToken =
    message.role === 'assistant' &&
    message.pending &&
    allEvents.length === 0 &&
    !message.content.trim()

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      {isUser ? (
        <div className="flex max-w-[75%] flex-col items-end gap-1.5">
          <div className="rounded-3xl bg-[#f4f4f4] px-5 py-3 text-[15px] leading-7 text-[#0d0d0d]">
            <MessageUser message={message} />
          </div>
          <div className="text-gray-400 mr-2 text-xs">{message.time}</div>
        </div>
      ) : (
        <div className="flex w-full max-w-full gap-4 md:gap-5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-[#fafafa] text-[#4b5563]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
              <path d="M12 12 2.1 7.1" />
              <path d="M12 12l9.9 4.9" />
            </svg>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden pt-1 text-[15px] leading-7 text-[#1f2937]">
            <div className="flex items-center gap-2.5">
              <span className="font-medium text-[#374151]">Agent</span>
              <span className="text-xs text-[#9ca3af]">{message.time}</span>
            </div>

            {allEvents.length > 0 ? (
              <div className="flex flex-col gap-4 text-[13px] leading-6 text-[#374151]">
                {allEvents.map((e, idx) => {
                  if (e.kind === 'thinking_chunk') {
                    const isLastEvent = idx === allEvents.length - 1
                    return (
                      <DeepThinkingSection
                        key={`${e.time}-${idx}`}
                        text={e.message}
                        isStreaming={isStreaming && isLastEvent}
                      />
                    )
                  }
                  return (
                    <div
                      key={`${e.time}-${idx}`}
                      className={`relative flex gap-3 rounded-xl border px-4 py-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] ${e.kind === 'assistant_text'
                        ? 'border-[#ececee] bg-[#f9fafb] text-[#1f2937]'
                        : 'border-[#e8eaed] bg-[#f4f5f7] text-[#374151]'}`}
                    >
                      <span className="shrink-0 text-xs text-[#9ca3af]">{e.time}</span>
                      <span className="min-w-0 flex-1 break-words">
                        {e.kind !== 'assistant_text' && e.tool ? (
                          <>
                            <span className="font-medium text-[#4b5563]">{e.tool}</span>
                            <span className="mr-1 text-[#9ca3af]">：</span>
                          </>
                        ) : null}
                        <MarkdownRenderer
                          content={e.message}
                          className="prose prose-sm prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-pre:my-1 prose-pre:max-w-full prose-pre:overflow-x-auto max-w-none text-inherit"
                        />
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : !waitingFirstToken && message.content.trim() ? (
              <div className="min-w-0 break-words">
                <MarkdownRenderer content={message.content} />
              </div>
            ) : null}

            {isStreaming ? (
              <div className="py-2">
                <ThinkingIndicator />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(ChatMessageItem)
