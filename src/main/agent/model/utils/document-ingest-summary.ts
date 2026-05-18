import { HumanMessage, SystemMessage } from '@langchain/core/messages'

import { createSummaryModel } from './summary'

function extractPlainText(response: {
  content?: unknown
  contentBlocks?: Array<{ type?: string; text?: string }>
}): string {
  const raw = response.content
  if (typeof raw === 'string' && raw.trim()) return raw

  if (Array.isArray(raw)) {
    const joined = raw
      .map((item) =>
        typeof item === 'string' ? item : (item as { text?: string })?.text ?? ''
      )
      .join('')
    if (joined.trim()) return joined
  }

  if (Array.isArray(response.contentBlocks)) {
    const joined = response.contentBlocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('')
    if (joined.trim()) return joined
  }

  return ''
}

/** 对单个切片生成简短中文摘要（用于合并成全文摘要） */
export async function summarizeDocumentSegment(
  segment: string,
  signal?: AbortSignal
): Promise<string> {
  const text = segment.trim()
  if (!text) return ''

  const model = createSummaryModel()
  const response = await model.invoke(
    [
      new SystemMessage(
        [
          '你是文档分段摘要助手。',
          '请用 1～3 句中文概括下面这段正文的关键信息，不要标题、不要编号、不要客套话。',
          '不要编造原文没有的内容。',
        ].join('\n')
      ),
      new HumanMessage(text.slice(0, 24_000)),
    ],
    { signal }
  )

  return extractPlainText(
    response as unknown as {
      content?: unknown
      contentBlocks?: Array<{ type?: string; text?: string }>
    }
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800)
}

/** 将各段摘要合并为整篇文档摘要，写入 MySQL */
export async function mergeDocumentSegmentSummaries(
  segmentSummaries: string[],
  signal?: AbortSignal
): Promise<string> {
  const parts = segmentSummaries.map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return ''

  const model = createSummaryModel()
  const body =
    parts.length === 1
      ? parts[0]
      : parts.map((p, i) => `【段 ${i + 1}】\n${p}`).join('\n\n')

  const response = await model.invoke(
    [
      new SystemMessage(
        [
          '你是整篇文档摘要助手。',
          '下面给出文档各段的摘要要点，请合并为一段连贯的中文摘要。',
          '控制在约 200～600 字，不要列表符号堆砌，不要重复啰嗦，不要编造。',
        ].join('\n')
      ),
      new HumanMessage(body.slice(0, 28_000)),
    ],
    { signal }
  )

  return extractPlainText(
    response as unknown as {
      content?: unknown
      contentBlocks?: Array<{ type?: string; text?: string }>
    }
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)
}
