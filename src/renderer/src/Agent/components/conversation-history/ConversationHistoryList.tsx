import type { AgentConversation } from '../../types'
import ConversationHistoryItem from './ConversationHistoryItem'

export interface ConversationHistoryListProps {
  conversations: AgentConversation[]
  activeSessionId: string
  onSelect: (conversation: AgentConversation) => void
  onDelete: (id: string) => void
}

/** 由若干 {@link ConversationHistoryItem} 组成的历史列表容器 */
export default function ConversationHistoryList({
  conversations,
  activeSessionId,
  onSelect,
  onDelete
}: ConversationHistoryListProps) {
  return (
    <div className="agent-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6 pt-1">
      <ul className="flex flex-col">
        {conversations.map((item) => (
          <ConversationHistoryItem
            key={item.id}
            item={item}
            active={item.id === activeSessionId}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  )
}
