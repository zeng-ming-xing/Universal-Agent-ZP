/** 与本地 serve 中 POST /embeddings/search 返回的单条结果对齐 */
export type RagVectorHit = {
  record: {
    id?: string
    message_id?: bigint | string
    conversation_id?: string
    role?: string
    content: string
    metadata?: unknown
    created_at?: Date | string
  }
  similarity: number
}

export type RagRetrieveOptions = {
  /** 仅在该会话内检索；不传则全库检索 */
  conversationId?: string
  limit?: number
  minSimilarity?: number
  /**
   * 向量检索范围，与本地 serve POST /embeddings/search 一致。
   * `documents`：仅用户上传知识文档分段（agent_document_chunk_embeddings）。
   */
  source?: 'all' | 'messages' | 'documents'
}

export type RagOperatorOptions = {
  /**
   * 向量 HTTP 服务根地址（与 mysql-service 同端口，见 serve/createServer.mjs）。
   * 默认 http://127.0.0.1:${AGENT_MYSQL_SERVICE_PORT ?? '37123'}
   */
  vectorApiBase?: string
  /** 本地向量检索 HTTP 超时（ms） */
  timeoutMs?: number
  /** 智谱 embedding 请求超时（ms） */
  embeddingTimeoutMs?: number
  fetchImpl?: typeof fetch
}

export type RagIngestProgress = {
  stage: 'read' | 'chunk' | 'segment' | 'merge' | 'mysql' | 'embedding' | 'done' | 'error'
  message: string
  current?: number
  total?: number
}
