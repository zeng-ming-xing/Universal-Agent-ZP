import type { RagVectorHit } from '../types'

/** 将检索到的片段格式化为可拼进提示词的上下文块 */
export function buildRagContextFromHits(hits: RagVectorHit[]): string {
  if (!hits.length) {
    return ''
  }
  return hits
    .map((h, i) => {
      const sim =
        typeof h.similarity === 'number' && !Number.isNaN(h.similarity)
          ? ` (similarity=${h.similarity.toFixed(4)})`
          : ''
      return `[#${i + 1}${sim}]\n${h.record.content.trim()}`
    })
    .join('\n\n---\n\n')
}
