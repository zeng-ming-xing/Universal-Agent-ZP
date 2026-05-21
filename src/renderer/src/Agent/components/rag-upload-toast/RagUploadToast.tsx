import { memo } from 'react'

export type RagUploadToastKind = 'loading' | 'success' | 'error'

export type RagUploadToastState = {
  kind: RagUploadToastKind
  message: string
  current?: number
  total?: number
}

export interface RagUploadToastProps {
  state: RagUploadToastState | null
  onDismiss?: () => void
}

const kindStyles: Record<RagUploadToastKind, { bar: string; icon: string }> = {
  loading: { bar: 'bg-blue-500', icon: 'text-blue-600' },
  success: { bar: 'bg-emerald-500', icon: 'text-emerald-600' },
  error: { bar: 'bg-red-500', icon: 'text-red-600' }
}

/** RAG 文档入库：顶部居中进度/结果提示 */
const RagUploadToast = ({ state, onDismiss }: RagUploadToastProps) => {
  if (!state) return null

  const { kind, message, current, total } = state
  const styles = kindStyles[kind]
  const hasProgress =
    kind === 'loading' && typeof current === 'number' && typeof total === 'number' && total > 0
  const percent = hasProgress ? Math.min(100, Math.round((current / total) * 100)) : null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-xl border border-[#e8eaed] bg-white px-4 py-3 shadow-lg shadow-black/8">
        <div className={`mt-0.5 shrink-0 ${styles.icon}`} aria-hidden>
          {kind === 'loading' ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5 animate-spin"
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
          ) : kind === 'success' ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#1f2328]">{message}</p>
          {hasProgress && percent !== null ? (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-xs text-[#64748b]">
                <span>处理进度</span>
                <span>
                  {current}/{total}（{percent}%）
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#e8eaed]">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${styles.bar}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : kind === 'loading' ? (
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-[#e8eaed]">
              <div
                className={`absolute inset-y-0 left-0 w-[32%] rounded-full ${styles.bar}`}
                style={{ animation: 'ragToastBar 1.2s ease-in-out infinite' }}
              />
            </div>
          ) : null}
        </div>

        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-md p-1 text-[#94a3b8] transition hover:bg-[#f1f5f9] hover:text-[#475569]"
            aria-label="关闭提示"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      <style>{`
        @keyframes ragToastBar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(220%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  )
}

export default memo(RagUploadToast)
