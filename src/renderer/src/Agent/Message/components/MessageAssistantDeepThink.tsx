import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ParsedDeepThink } from '../utils';

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`text-slate-500 h-4 w-4 shrink-0 transition-transform duration-300 ease-out ${
        open ? 'rotate-180' : 'rotate-0'
      }`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface MessageAssistantDeepThinkProps {
  parsed: ParsedDeepThink;
}

/** 深度思考 Toggle 区域（Markdown 渲染） */
const MessageAssistantDeepThink = ({
  parsed,
}: MessageAssistantDeepThinkProps) => {
  const { inThinkingBlock, thinking } = parsed;
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (inThinkingBlock) setOpen(true);
  }, [inThinkingBlock]);

  const hasThinkingText = (thinking?.trim().length ?? 0) > 0;
  const showInnerLoader = inThinkingBlock && !hasThinkingText;

  return (
    <div className="border-slate-200/90 from-slate-50 ring-slate-900/[0.04] overflow-hidden rounded-xl border bg-gradient-to-b to-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-slate-50/80 flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors"
        aria-expanded={open}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="bg-violet-100/90 text-violet-700 inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold uppercase tracking-wide">
            深度思考
          </span>
          {inThinkingBlock ? (
            <span className="text-violet-600/90 inline-flex items-center gap-1.5 text-[11px]">
              <span className="relative flex h-2 w-2">
                <span className="bg-violet-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" />
                <span className="bg-violet-500 relative inline-flex h-2 w-2 rounded-full" />
              </span>
              生成中
            </span>
          ) : (
            <span className="text-slate-400 truncate text-[11px]">
              点击展开或收起
            </span>
          )}
        </div>
        <ChevronIcon open={open} />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-slate-200/80 border-t bg-[#fafbfc] px-3.5 py-3">
            <div
              className={`border-slate-200/60 max-h-[min(40vh,320px)] overflow-y-auto rounded-lg border bg-white/90 px-3 py-2.5 shadow-inner transition-opacity duration-300 ${
                showInnerLoader ? 'opacity-95' : 'opacity-100'
              }`}
            >
              {showInnerLoader ? (
                <div className="space-y-2">
                  <div className="bg-slate-200/70 h-3.5 w-[86%] rounded" />
                  <div className="bg-slate-200/60 h-3.5 w-[72%] rounded" />
                  <div className="bg-slate-200/60 h-3.5 w-[64%] rounded" />
                </div>
              ) : (
                <div className="text-slate-600 text-[12px] leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {thinking ?? ''}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(MessageAssistantDeepThink);
