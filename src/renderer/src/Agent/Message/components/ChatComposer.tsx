import { memo } from 'react';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAbort?: () => void;
  sending?: boolean;
}

const ChatComposer = ({
  value,
  onChange,
  onSend,
  onAbort,
  sending = false,
}: ChatComposerProps) => {
  const canSend = Boolean(value.trim()) && !sending;

  return (
    <footer>
      <div className="focus-within:ring-gray-200 relative flex flex-col rounded-3xl bg-[#f4f4f4] px-4 py-3 focus-within:ring-1">
        <textarea
          className="max-h-[200px] min-h-[44px] w-full resize-none border-none bg-transparent py-1.5 pr-12 text-[15px] leading-6 text-[#0d0d0d] outline-none placeholder:text-[#8e8e8e]"
          value={value}
          placeholder="给 Agent 发送消息"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {sending && onAbort ? (
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white transition hover:opacity-80"
              onClick={onAbort}
              title="停止生成"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
              canSend
                ? 'bg-black text-white hover:opacity-80'
                : 'cursor-not-allowed bg-[#e5e5e5] text-[#a3a3a3]'
            }`}
            onClick={onSend}
            disabled={!canSend}
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
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="mt-2 text-center text-xs text-[#8e8e8e]">
        Agent 可能会犯错。请核查重要信息。
      </div>
    </footer>
  );
};

export default memo(ChatComposer);
