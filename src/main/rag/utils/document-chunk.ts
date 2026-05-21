import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

const DEFAULT_MAX_CHUNK_CHARS = 1200
const DEFAULT_OVERLAP_CHARS = 80
const MIN_CHUNK_CHARS = 256

/**
 * 使用 LangChain RecursiveCharacterTextSplitter：优先按段落/换行/空格递归切分。
 */
export async function chunkDocument(
  text: string,
  opts?: { maxChunkChars?: number; overlapChars?: number }
): Promise<string[]> {
  const chunkSize = Math.max(MIN_CHUNK_CHARS, opts?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS)
  const chunkOverlap = Math.max(
    0,
    Math.min(opts?.overlapChars ?? DEFAULT_OVERLAP_CHARS, Math.floor(chunkSize / 2))
  )

  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ['\n\n', '\n', ' ', '']
  })

  const chunks = await splitter.splitText(normalized)
  return chunks.map((c) => c.trim()).filter(Boolean)
}
