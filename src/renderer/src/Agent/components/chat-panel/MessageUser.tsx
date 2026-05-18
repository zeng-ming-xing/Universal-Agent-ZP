/** 用户消息展示组件（Markdown 渲染，深色文本） */
import { memo } from 'react'
import type { ChatMessage } from '../../types'
import MarkdownRenderer from './MarkdownRenderer'

interface MessageUserProps {
  message: ChatMessage
}

const MessageUser = ({ message }: MessageUserProps) => {
  return (
    <MarkdownRenderer
      content={message.content}
      className="prose prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2 prose-code:text-inherit max-w-none text-[15px] leading-7 text-[#0d0d0d]"
    />
  )
}

export default memo(MessageUser)
