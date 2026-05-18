import type { BaseMessage } from '@langchain/core/messages';

/** 从消息列表中提取最后一条 AI 消息的文本内容 */
export function extractLastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.getType() !== 'ai') continue;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((item) =>
          typeof item === 'string'
            ? item
            : (item as { text?: string }).text ?? ''
        )
        .join('');
    }
    return (content as { text?: string })?.text ?? '';
  }
  return '';
}
