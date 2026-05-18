import NewConversationButton from './NewConversationButton'
import UploadDocumentButton from './UploadDocumentButton'

export interface SidebarActionsProps {
  onNewConversation: () => void
  documentUploading: boolean
  onDocumentUpload: () => void | Promise<void>
}

/** 侧栏顶部操作区：可在此扩展更多图标按钮 */
export default function SidebarActions({
  onNewConversation,
  documentUploading,
  onDocumentUpload
}: SidebarActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <NewConversationButton onClick={onNewConversation} />
      <UploadDocumentButton uploading={documentUploading} onUpload={onDocumentUpload} />
    </div>
  )
}
