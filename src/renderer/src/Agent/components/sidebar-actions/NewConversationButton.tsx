import { memo } from 'react'

export interface NewConversationButtonProps {
  onClick: () => void
}

/** 侧栏顶部：新建对话（仅图标） */
const NewConversationButton = ({ onClick }: NewConversationButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title="新建对话"
      aria-label="新建对话"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#334155] transition hover:bg-[#e8eaed] hover:text-[#0f172a]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    </button>
  )
}

export default memo(NewConversationButton)
