import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageAssistantAnswerProps {
  /** 结论/回答（Markdown） */
  content: string;
}

const MessageAssistantAnswer = ({ content }: MessageAssistantAnswerProps) => {
  if (!content.trim()) return null;

  return (
    <div className="border-slate-100 rounded-xl border bg-white px-3.5 py-3">
      <div className="text-[#1f2328]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
};

export default memo(MessageAssistantAnswer);
