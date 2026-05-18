/**
 * 消息列表容器
 * 自动滚底（用户干预后停止）、滚动到顶部/底部按钮、消息条目渲染
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../types'
import ChatMessageItem from './ChatMessageItem'

interface ChatMessageListProps {
  messages: ChatMessage[]
  abortableMessageId?: number | null
}

const ChatMessageList = ({ messages, abortableMessageId }: ChatMessageListProps) => {
  const listRef = useRef<HTMLDivElement>(null)
  const [isUserInterfered, setIsUserInterfered] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const updateScrollFlags = useCallback(() => {
    const list = listRef.current
    if (!list) return

    const top = list.scrollTop
    const maxTop = list.scrollHeight - list.clientHeight
    const distanceToBottom = maxTop - top
    const threshold = 36

    setShowScrollTop(top > threshold)
    setShowScrollBottom(distanceToBottom > threshold)
    setIsUserInterfered(distanceToBottom > threshold)
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    const list = listRef.current
    if (!list) return
    list.scrollTo({
      top: list.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    })
  }, [])

  const scrollToTop = useCallback(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!messages.length) return
    if (!isUserInterfered) {
      scrollToBottom(false)
    }
  }, [messages, isUserInterfered, scrollToBottom])

  useEffect(() => {
    updateScrollFlags()
  }, [updateScrollFlags, messages.length])

  return (
    <div className="relative h-full">
      <main
        ref={listRef}
        onScroll={updateScrollFlags}
        className="agent-scroll flex h-full flex-col gap-8 overflow-y-auto overflow-x-hidden px-3 pb-14 pt-6 md:px-4 md:pb-16 md:pt-8"
      >
        {messages.map((item) => (
          <ChatMessageItem
            key={item.id}
            message={item}
            showAbort={abortableMessageId === item.id}
          />
        ))}
      </main>

      <div className="absolute bottom-4 right-3 flex flex-col gap-2">
        {showScrollTop ? (
          <button
            type="button"
            onClick={scrollToTop}
            className="h-8 w-8 rounded-full border border-[#d0d5dd] bg-white text-[#344054] shadow hover:bg-[#f9fafb]"
            title="滚动到顶部"
          >
            ↑
          </button>
        ) : null}
        {showScrollBottom ? (
          <button
            type="button"
            onClick={() => {
              setIsUserInterfered(false)
              scrollToBottom()
            }}
            className="h-8 w-8 rounded-full border border-[#d0d5dd] bg-white text-[#344054] shadow hover:bg-[#f9fafb]"
            title="滚动到底部"
          >
            ↓
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default memo(ChatMessageList)
