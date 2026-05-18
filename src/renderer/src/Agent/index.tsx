
import { memo, useCallback, useState } from 'react'
import AgentChatPanel from './components/chat-panel/AgentChatPanel'
import AgentComposerPanel from './components/composer-panel/AgentComposerPanel'
import ConversationHistoryList from './components/conversation-history/ConversationHistoryList'
import SidebarActions from './components/sidebar-actions/SidebarActions'
import { useAgentConversations } from './hooks/useAgentConversations'

/**
 * Message 主组件 —— Agent 对话面板
 *
 * 布局与逻辑已拆分为：侧栏操作、历史列表、聊天区、输入区；状态与 IPC 见 {@link useAgentConversations}。
 */
const Message = () => {
  const {
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
  } = useAgentConversations()

  const [documentUploading, setDocumentUploading] = useState(false)

  const handleDocumentUpload = useCallback(async () => {
    if (documentUploading || typeof window === 'undefined') return
    const ipc = window.ipc
    if (!ipc?.ragPickDocumentPath || !ipc?.ragUploadDocument) return

    setDocumentUploading(true)
    try {
      const path = await ipc.ragPickDocumentPath()
      if (!path) return

      const result = await ipc.ragUploadDocument(path, {
        onProgress: () => undefined
      })
      if (result.ok) {
        const snippet = result.summary.trim().slice(0, 1200)
        const hint = `【已索引文档：${result.title}】（${result.chunkCount} 段）\n${snippet}`
        setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${hint}` : hint))
      } else {
        console.error('[RAG]', result.error)
      }
    } catch (e) {
      console.error('[RAG]', e)
    } finally {
      setDocumentUploading(false)
    }
  }, [documentUploading, setInput])

  return (
    <div className="flex h-screen min-h-0 gap-6 bg-white text-[#1f2328] pr-4">
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-[#e8eaed] bg-[#f6f7f9] py-5 pl-3 pr-3">
        <SidebarActions
          onNewConversation={() => void createConversation()}
          documentUploading={documentUploading}
          onDocumentUpload={handleDocumentUpload}
        />
        <ConversationHistoryList
          conversations={conversations}
          activeSessionId={activeSessionId}
          onSelect={selectConversation}
          onDelete={(id) => void removeConversation(id)}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-1">
        <AgentChatPanel activeConversation={activeConversation} />
        <AgentComposerPanel
          value={input}
          onChange={setInput}
          onSend={sendMessage}
          onAbort={abortAnswer}
          sending={Boolean(activeConversation?.isSending)}
        />
      </div>
    </div>
  )
}

export default memo(Message)
