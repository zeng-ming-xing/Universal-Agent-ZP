import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { createModel } from '..';

/**
 * 轻量摘要模型：专门用于「会话首条消息 → 会话标题」等一次性短文本调用。
 * - 不走 Agent、不接工具、不参与历史记忆
 * - 较低温度 + 足够 token 上限，快速稳定输出短标题
 * - 显式关闭 thinking/深度思考，避免思考 token 耗尽后正文为空
 */
export function createSummaryModel() {
  return createModel({
    temperature: 0.2,
    maxTokens: 512,
    modelKwargs: {
      thinking: { type: 'disabled' },
    },
  });
}

/** 从 AIMessage 的多种 content 形态中提取正文文本（兼容 contentBlocks / 数组 / 字符串） */
function extractPlainText(response: {
  content?: unknown;
  contentBlocks?: Array<{ type?: string; text?: string }>;
}): string {
  const raw = response.content;
  if (typeof raw === 'string' && raw.trim()) return raw;

  if (Array.isArray(raw)) {
    const joined = raw
      .map((item) =>
        typeof item === 'string' ? item : (item as { text?: string })?.text ?? ''
      )
      .join('');
    if (joined.trim()) return joined;
  }

  if (Array.isArray(response.contentBlocks)) {
    const joined = response.contentBlocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    if (joined.trim()) return joined;
  }

  return '';
}

/**
 * 根据用户的第一句消息生成不超过 18 字的中文会话标题。
 * - 纯 invoke（非流式），返回裁剪后的纯文本
 * - 失败时抛出原始错误，由上层决定是否忽略
 */
export async function summarizeFirstMessage(
  firstMessage: string,
  signal?: AbortSignal
): Promise<string> {
  const source = firstMessage.trim();
  if (!source) return '';

  const model = createSummaryModel();
  const response = await model.invoke(
    [
      new SystemMessage(
        [
          '你是会话标题生成器。',
          '根据用户的第一句话，生成不超过 18 个字的中文标题。',
          '只输出标题文本：不要引号、不要序号、不要标点包裹、不要解释。',
        ].join('\n')
      ),
      new HumanMessage(source),
    ],
    { signal }
  );

  const text = extractPlainText(
    response as unknown as {
      content?: unknown;
      contentBlocks?: Array<{ type?: string; text?: string }>;
    }
  );
  const summary = text
    .replace(/^["'“‘「『【《（(\[]+/, '')
    .replace(/["'”’」』】》）)\]]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

  if (!summary) {
    console.warn(
      '[summarizeFirstMessage] 模型返回空摘要，response=',
      JSON.stringify(response, null, 2)
    );
  }
  return summary;
}
