/**
 * 按段落优先、再按最大字符数切分，适合作为简单入库分块策略。
 */
export function chunkDocument(
  text: string,
  opts?: { maxChunkChars?: number; overlapChars?: number }
): string[] {
  const max = Math.max(256, opts?.maxChunkChars ?? 1200)
  const overlap = Math.max(0, Math.min(opts?.overlapChars ?? 80, Math.floor(max / 2)))
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }
  const paragraphs = normalized.split(/\n{2,}/)
  const chunks: string[] = []
  for (const p of paragraphs) {
    const part = p.trim()
    if (!part) {
      continue
    }
    if (part.length <= max) {
      chunks.push(part)
      continue
    }
    let start = 0
    while (start < part.length) {
      const end = Math.min(part.length, start + max)
      chunks.push(part.slice(start, end).trim())
      if (end >= part.length) {
        break
      }
      start = Math.max(end - overlap, start + 1)
    }
  }
  return chunks.filter(Boolean)
}
