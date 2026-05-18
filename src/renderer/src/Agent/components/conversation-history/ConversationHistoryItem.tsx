import { memo } from 'react'
import type { AgentConversation } from '../../types'
import { formatRelativeTimeZh } from '../../utils'

export interface ConversationHistoryItemProps {
  item: AgentConversation
  active: boolean
  onSelect: (conversation: AgentConversation) => void
  onDelete: (id: string) => void
}

/** 单条历史记录：标题 + 相对时间，悬停显示删除 */
const ConversationHistoryItem = ({
  item,
  active,
  onSelect,
  onDelete
}: ConversationHistoryItemProps) => {
  const title = item.summary || item.title
  const relative = formatRelativeTimeZh(item.updatedAt)

  return (
    <li>
      <div className="group relative flex items-center justify-between gap-3 px-2 py-3.5 transition">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelect(item)}
        >
          <span
            className={`block truncate text-[15px] leading-snug ${active ? 'font-medium text-[#1f2328]' : 'text-[#3d4248]'}`}
          >
            {title}
          </span>
        </button>

        <div className="relative flex shrink-0 items-center">
          <span
            className={`text-xs tabular-nums text-[#9aa0a6] transition group-hover:opacity-0 ${active ? 'text-[#8b9199]' : ''}`}
          >
            {relative}
          </span>
          <button
            type="button"
            title="删除对话"
            aria-label="删除对话"
            className="absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-[#9aa0a6] opacity-0 transition hover:text-[#475569] group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(item.id)
            }}
          >
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
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" x2="10" y1="11" y2="17" />
              <line x1="14" x2="14" y1="11" y2="17" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  )
}

export default memo(ConversationHistoryItem)
