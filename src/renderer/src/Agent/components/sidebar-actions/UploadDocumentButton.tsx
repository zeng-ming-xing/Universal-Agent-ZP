import { memo, useCallback } from 'react'

export interface UploadDocumentButtonProps {
  uploading: boolean
  onUpload: () => void | Promise<void>
}

/** 侧栏：选择本地文档并走主进程 RAG 入库（切片、摘要、MySQL、向量库） */
const UploadDocumentButton = ({ uploading, onUpload }: UploadDocumentButtonProps) => {
  const handleClick = useCallback(() => {
    if (uploading) return
    void onUpload()
  }, [onUpload, uploading])

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={uploading}
      title={
        uploading
          ? '正在索引文档，请稍候…'
          : '上传知识文档：切片、生成摘要并写入数据库与向量库（.md / .txt）'
      }
      aria-label={
        uploading
          ? '文档正在索引中，请稍候'
          : '上传知识文档以建立检索索引，支持 Markdown 与纯文本'
      }
      aria-busy={uploading}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#334155] transition hover:bg-[#e8eaed] hover:text-[#0f172a] disabled:pointer-events-none disabled:opacity-50"
    >
      {uploading ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 animate-spin"
          aria-hidden
        >
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M4.93 4.93l2.83 2.83" />
          <path d="M16.24 16.24l2.83 2.83" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path d="M4.93 19.07l2.83-2.83" />
          <path d="M16.24 7.76l2.83-2.83" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <circle cx="16.5" cy="16.5" r="2.5" />
          <path d="M21 21l-2.35-2.35" />
        </svg>
      )}
    </button>
  )
}

export default memo(UploadDocumentButton)
