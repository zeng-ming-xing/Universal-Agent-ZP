import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';

export type MysqlConversationMessageRow = {
  role?: string;
  content?: string;
};

/** 将 mysql-service 持久化的消息行转为 LangChain 消息（当前前端仅持久化 user / assistant） */
export function conversationRowsToBaseMessages(
  rows: MysqlConversationMessageRow[]
): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const row of rows) {
    const role = String(row.role ?? 'user').toLowerCase();
    const content = String(row.content ?? '').trim();
    if (!content) continue;
    if (role === 'assistant') {
      out.push(new AIMessage(content));
    } else {
      out.push(new HumanMessage(content));
    }
  }
  return out;
}
