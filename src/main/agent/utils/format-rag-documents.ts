import type { MysqlAgentDocumentRow } from '../tools/mysql/client'

export const RAG_DOCUMENTS_PROMPT_MAX_CHARS = Number(
  process.env.AGENT_RAG_DOCUMENTS_PROMPT_MAX_CHARS ?? '12000'
)

const SINGLE_SUMMARY_MAX = Number(process.env.AGENT_RAG_SINGLE_SUMMARY_MAX_CHARS ?? '1200')

/** 将 GET /documents 结果格式化为系统提示附录（供模型选题与理解知识库边界） */
export function formatRagDocumentsForPrompt(
  documents: MysqlAgentDocumentRow[]
): string {
  if (!documents.length) {
    return ''
  }
  const lines: string[] = []
  for (const d of documents) {
    const title = (d.title ?? '').trim() || d.id
    let sum = (d.summary ?? '').trim().replace(/\s+/g, ' ')
    if (sum.length > SINGLE_SUMMARY_MAX) {
      sum = sum.slice(0, SINGLE_SUMMARY_MAX) + '…'
    }
    lines.push(
      `- [id=${d.id}] ${title}（分段数 ${d.chunk_count ?? 0}）\n  摘要：${sum || '（无摘要）'}`
    )
  }
  let text = lines.join('\n')
  if (text.length > RAG_DOCUMENTS_PROMPT_MAX_CHARS) {
    text =
      text.slice(0, RAG_DOCUMENTS_PROMPT_MAX_CHARS) +
      '\n…(已截断；完整列表可由应用重新加载或后续接口获取)'
  }
  return text
}
