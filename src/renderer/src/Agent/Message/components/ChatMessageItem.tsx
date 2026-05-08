import { memo, useState } from 'react';
import type { AgentEvent, ChatMessage } from '../types';
import MessageUser from './MessageUser';
import ThinkingIndicator from './ThinkingIndicator';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatMessageItemProps {
  message: ChatMessage;
  showAbort?: boolean;
}

// ---------------------------------------------------------------------------
// 深度思考区块（可折叠 + 内容）
// ---------------------------------------------------------------------------

interface DeepThinkingSectionProps {
  text: string;
  isStreaming: boolean;
}

const DeepThinkingSection = memo(
  ({ text, isStreaming }: DeepThinkingSectionProps) => {
    const [collapsed, setCollapsed] = useState(false);

    return (
      <div className="w-full min-w-0">
        {/* 标题：折叠控制 */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex select-none items-center gap-1.5 bg-transparent py-0.5 text-[#94a3b8] hover:text-[#64748b]"
        >
          <span
            className={`text-[11px] font-medium uppercase tracking-wider ${
              isStreaming ? 'animate-pulse' : ''
            }`}
          >
            thinking
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-2.5 w-2.5 transition-transform duration-200 ${
              collapsed ? '-rotate-90' : 'rotate-0'
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* 思考内容：纯文字，无背景 */}
        {!collapsed && text && (
          <div className="mt-1 max-h-72 overflow-y-auto overflow-x-hidden">
            <div className="border-l border-[#e2e8f0] pl-3 text-[#64748b]">
              <MarkdownRenderer
                content={text}
                className="prose prose-xs prose-headings:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-pre:text-inherit prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:bg-transparent prose-pre:px-0 prose-pre:py-0 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 max-w-none break-words italic leading-[1.65] text-inherit"
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);

// ---------------------------------------------------------------------------
// 主消息条目
// ---------------------------------------------------------------------------

const ChatMessageItem = ({ message, showAbort }: ChatMessageItemProps) => {
  const isUser = message.role === 'user';

  const allEvents: AgentEvent[] = message.events ?? [];
  const isStreaming = Boolean(showAbort);

  const waitingFirstToken =
    message.role === 'assistant' &&
    message.pending &&
    allEvents.length === 0 &&
    !message.content.trim();

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      {isUser ? (
        <div className="flex max-w-[75%] flex-col items-end gap-1.5">
          <div className="rounded-3xl bg-[#f4f4f4] px-5 py-3 text-[15px] leading-7 text-[#0d0d0d]">
            <MessageUser message={message} />
          </div>
          <div className="text-gray-400 mr-2 text-xs">{message.time}</div>
        </div>
      ) : (
        <div className="flex w-full max-w-full gap-4 md:gap-5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-[#fafafa] text-[#4b5563]">
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
              <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
              <path d="M12 12 2.1 7.1" />
              <path d="M12 12l9.9 4.9" />
            </svg>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden pt-1 text-[15px] leading-7 text-[#1f2937]">
            <div className="flex items-center gap-2.5">
              <span className="font-medium text-[#374151]">Agent</span>
              <span className="text-xs text-[#9ca3af]">{message.time}</span>
            </div>

            {/* 按原始顺序渲染事件流：thinking_chunk 就地展示为深度思考区块 */}
            {allEvents.length > 0 ? (
              <div className="flex flex-col gap-4 text-[13px] leading-6 text-[#374151]">
                {allEvents.map((e, idx) => {
                  if (e.kind === 'thinking_chunk') {
                    // 该思考块是否仍在流式写入：它是最后一项且整体仍在流式中
                    const isLastEvent = idx === allEvents.length - 1;
                    return (
                      <DeepThinkingSection
                        key={`${e.time}-${idx}`}
                        text={e.message}
                        isStreaming={isStreaming && isLastEvent}
                      />
                    );
                  }
                  return (
                    <div
                      key={`${e.time}-${idx}`}
                      className={`relative flex gap-3 rounded-xl border px-4 py-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] ${
                        e.kind === 'assistant_text'
                          ? 'border-[#ececee] bg-[#f9fafb] text-[#1f2937]'
                          : 'border-[#e8eaed] bg-[#f4f5f7] text-[#374151]'
                      }`}
                    >
                      <span className="shrink-0 text-xs text-[#9ca3af]">{e.time}</span>
                      <span className="min-w-0 flex-1 break-words">
                        {e.kind !== 'assistant_text' && e.tool ? (
                          <>
                            <span className="font-medium text-[#4b5563]">{e.tool}</span>
                            <span className="mr-1 text-[#9ca3af]">：</span>
                          </>
                        ) : null}
                        <MarkdownRenderer
                          content={e.message}
                          className="prose prose-sm prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-pre:my-1 prose-pre:max-w-full prose-pre:overflow-x-auto max-w-none text-inherit"
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : !waitingFirstToken && message.content.trim() ? (
              <div className="min-w-0 break-words">
                <MarkdownRenderer content={message.content} />
              </div>
            ) : null}

            {isStreaming ? (
              <div className="py-2">
                <ThinkingIndicator />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(ChatMessageItem);
