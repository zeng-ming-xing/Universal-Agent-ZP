
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import AgentChatPanel from './components/chat-panel/AgentChatPanel'
import AgentComposerPanel from './components/composer-panel/AgentComposerPanel'
import ConversationHistoryList from './components/conversation-history/ConversationHistoryList'
import RagUploadToast, {
  type RagUploadToastState
} from './components/rag-upload-toast/RagUploadToast'
import SidebarActions from './components/sidebar-actions/SidebarActions'
import { useAgentConversations } from './hooks/useAgentConversations'

const RAG_TOAST_SUCCESS_MS = 4000

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
  const [ragToast, setRagToast] = useState<RagUploadToastState | null>(null)
  const ragToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRagToastTimer = useCallback(() => {
    if (ragToastTimerRef.current) {
      clearTimeout(ragToastTimerRef.current)
      ragToastTimerRef.current = null
    }
  }, [])

  const dismissRagToast = useCallback(() => {
    clearRagToastTimer()
    setRagToast(null)
  }, [clearRagToastTimer])

  const showRagToast = useCallback(
    (next: RagUploadToastState, autoDismissMs?: number) => {
      clearRagToastTimer()
      setRagToast(next)
      if (autoDismissMs && autoDismissMs > 0) {
        ragToastTimerRef.current = setTimeout(() => {
          setRagToast(null)
          ragToastTimerRef.current = null
        }, autoDismissMs)
      }
    },
    [clearRagToastTimer]
  )

  useEffect(() => () => clearRagToastTimer(), [clearRagToastTimer])

  const handleDocumentUpload = useCallback(async () => {
    if (documentUploading || typeof window === 'undefined') return
    const ipc = window.ipc
    if (!ipc?.ragPickDocumentPath || !ipc?.ragUploadDocument) return

    setDocumentUploading(true)
    showRagToast({ kind: 'loading', message: '请选择要索引的文档…' })
    try {
      const path = await ipc.ragPickDocumentPath()
      if (!path) {
        dismissRagToast()
        return
      }

      showRagToast({ kind: 'loading', message: '准备上传文档…' })
      const result = await ipc.ragUploadDocument(path, {
        onProgress: (p) => {
          if (p.stage === 'error') {
            showRagToast({ kind: 'error', message: p.message })
            return
          }
          if (p.stage === 'done') {
            showRagToast({
              kind: 'loading',
              message: p.message,
              current: p.current,
              total: p.total
            })
            return
          }
          showRagToast({
            kind: 'loading',
            message: p.message,
            current: p.current,
            total: p.total
          })
        }
      })
      if (result.ok) {
        const snippet = result.summary.trim().slice(0, 1200)
        const hint = `【已索引文档：${result.title}】（${result.chunkCount} 段）\n${snippet}`
        setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${hint}` : hint))
        showRagToast(
          {
            kind: 'success',
            message: `「${result.title}」已索引完成（${result.chunkCount} 段）`
          },
          RAG_TOAST_SUCCESS_MS
        )
      } else {
        showRagToast({ kind: 'error', message: result.error || '文档索引失败' })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '文档索引失败'
      console.error('[RAG]', e)
      showRagToast({ kind: 'error', message })
    } finally {
      setDocumentUploading(false)
    }
  }, [documentUploading, dismissRagToast, setInput, showRagToast])

  return (
    <div className="relative flex h-screen min-h-0 gap-6 bg-white text-[#1f2328] pr-4">
      <RagUploadToast state={ragToast} onDismiss={ragToast ? dismissRagToast : undefined} />
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
