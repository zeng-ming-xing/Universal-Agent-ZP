import type { AgentConversation } from '../../types'
import WelcomePanel from './WelcomePanel'
import ChatMessageList from './ChatMessageList'

export interface AgentChatPanelProps {
  activeConversation: AgentConversation | null
}

/** 右侧上半区：欢迎页或消息列表 */
export default function AgentChatPanel({ activeConversation }: AgentChatPanelProps) {
  const conv = activeConversation
  const hasMessages = Boolean(conv && conv.messages.length > 0)

  return (
    <main className="min-h-0 flex-1 overflow-hidden pt-6 pr-2 md:pr-4">
      {!hasMessages || !conv ? (
        <WelcomePanel />
      ) : (
        <div className="mx-auto h-full max-w-3xl px-2 md:px-4">
          <ChatMessageList
            messages={conv.messages}
            abortableMessageId={conv.abortableMessageId}
          />
        </div>
      )}
    </main>
  )
}
