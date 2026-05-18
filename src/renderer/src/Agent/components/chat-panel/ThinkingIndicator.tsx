/** 回答生成中动画：跳动圆点 + 横扫进度条，可复用 */
import { memo } from 'react'

/** 回答生成中：仅动画与进度条，不重复展示与上方气泡相同的步骤文案 */
const ThinkingIndicator = () => {
  return (
    <div className="flex flex-col gap-2.5 py-0.5">
      <div className="flex items-center gap-3">
        <div className="relative flex h-4 w-4 items-center justify-center">
          <span className="absolute inline-flex h-4 w-4 rounded-full bg-slate-300/50 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-500" />
        </div>

        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400"
              style={{
                animation: 'agentThinkDot 1.1s ease-in-out infinite',
                animationDelay: `${i * 120}ms`
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative h-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className="absolute inset-y-0 left-0 w-[32%] rounded-full bg-slate-400/90"
          style={{ animation: 'agentThinkBar 1.2s ease-in-out infinite' }}
        />
      </div>

      <style>{`
        @keyframes agentThinkDot {
          0%, 70%, 100% { transform: translateY(0); opacity: 0.45; }
          35% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes agentThinkBar {
          0% { left: -32%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  )
}

export default memo(ThinkingIndicator)
