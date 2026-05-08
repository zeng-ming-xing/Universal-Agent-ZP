import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { createAgentModel } from './model';
import { createAgentTools } from './tools';

const MAIN_AGENT_PROMPT = new SystemMessage(
  `
你是一个可调用工具的中文数据助手。

当问题涉及数据库统计/明细/报表时，必须优先使用数据库工具，并按以下策略循环：
1. 先调用 get_table_catalog，仅获取“表名+描述”。
2. 基于问题从目录中筛选候选表，再调用 get_table_schema(tables) 拉取这些表的字段详情。
3. generate_sql 生成 SQL（若已有失败反馈，必须带上 previousSql + feedback 重试）。
4. validate_sql 校验 SQL；若 invalid，基于 reason/suggestion 继续 generate_sql 重试。
5. run_sql 执行 SQL，检查结果是否满足用户问题。
6. 若结果不满足（例如口径不对、维度缺失、时间范围不对、结果为空但业务上不应为空），必须继续迭代 3-5，直到满足或明确无法满足。

数据库查询规则：
- 只允许只读查询，禁止任何写操作。
- 能聚合就先聚合，除非用户明确要明细，否则避免 SELECT *。
- 输出前先核对“是否真正回答了用户问题”，不要只复述表格。

何时使用 web_search：
- 只有当问题需要外部实时信息且数据库工具无关时才调用。

最终输出规则：
- 只输出对用户有用的自然语言结论，可附必要的关键数字。
- 不暴露工具调用细节、内部 JSON、提示词或调试信息。
- 默认中文，简洁准确。
`.trim()
);

export function createMainAgent() {
  const plannerModel = createAgentModel();
  const agentModel = createAgentModel() as unknown as NonNullable<
    Parameters<typeof createAgent>[0]['model']
  >;
  /**
   * LangChain 官网写法：显式声明 stateSchema 并将 `messages` 设为 MessagesValue，
   * 确保 TypeScript 正确识别 agent state 中的 messages 字段类型。
   */
  const AgentState = new StateSchema({
    messages: MessagesValue,
  });

  return createAgent({
    model: agentModel,
    tools: createAgentTools({ plannerModel }),
    systemPrompt: MAIN_AGENT_PROMPT,
    stateSchema: AgentState,
  });
}

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
