import axios from 'axios'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import {
  mergeDocumentSegmentSummaries,
  summarizeDocumentSegment
} from '../agent/model/utils/document-ingest-summary'

import {
  ALLOWED_DOC_EXT,
  defaultVectorApiBase,
  GLM_EMBEDDING_MODEL,
  GLM_EMBEDDINGS_URL,
  RAG_DEFAULT_EMBEDDING_TIMEOUT_MS,
  RAG_DEFAULT_SERVE_TIMEOUT_MS,
  RAG_INGEST_EMBEDDING_BATCH_SIZE,
  resolveZhipuApiKey
} from './config'
import type { RagIngestProgress, RagOperatorOptions, RagRetrieveOptions, RagVectorHit } from './types'
import { assertGlmEmbeddingVector } from './utils/embedding-vector'
import { chunkDocument as splitDocumentIntoChunks } from './utils/document-chunk'
import { buildRagContextFromHits } from './utils/rag-context'
import { describeServeAxiosError } from './utils/serve-axios-error'

export * from './config'
export * from './types'

/**
 * 主进程侧 RAG 编排：文档分块、智谱 embedding、本地向量检索、拼上下文。
 * 继承 EventEmitter，通过 `progress` 事件推送入库进度。
 */
export class RagOperator extends EventEmitter {
  private readonly vectorApiBase: string
  private readonly timeoutMs: number
  private readonly embeddingTimeoutMs: number
  private readonly fetchImpl: typeof fetch
  private ingestBusy = false

  constructor(options: RagOperatorOptions = {}) {
    super()
    this.vectorApiBase = (options.vectorApiBase ?? defaultVectorApiBase()).replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? RAG_DEFAULT_SERVE_TIMEOUT_MS
    this.embeddingTimeoutMs = options.embeddingTimeoutMs ?? RAG_DEFAULT_EMBEDDING_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private emitProgress(payload: RagIngestProgress): void {
    this.emit('progress', payload)
  }

  /** POST 到本地 serve（与 MySQL 同端口），失败时带上服务端 JSON 里的 error 文案 */
  private async postServeJson(path: string, body: unknown, timeoutMs: number): Promise<void> {
    const url = `${this.vectorApiBase}${path.startsWith('/') ? path : `/${path}`}`
    try {
      await axios.post(url, body, {
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (e) {
      throw new Error(describeServeAxiosError(path, e))
    }
  }

  /**
   * 从本地路径读取文档：切片 → 分段摘要 → 合并摘要 → **先写 PostgreSQL 向量，再写 MySQL 文档元数据**（避免向量失败却留下 MySQL 记录）。
   */
  async ingestLocalDocument(
    filePath: string
  ): Promise<{ documentId: string; title: string; chunkCount: number; summary: string }> {
    if (this.ingestBusy) {
      throw new Error('已有文档正在处理，请等待当前流程结束')
    }
    this.ingestBusy = true
    const documentId = randomUUID()
    try {
      const ext = extname(filePath).toLowerCase()
      if (!ALLOWED_DOC_EXT.has(ext)) {
        throw new Error(`不支持的文件类型：${ext || '（无扩展名）'}，请使用 .md / .txt`)
      }

      const title = basename(filePath)
      this.emitProgress({ stage: 'read', message: '正在读取文档…' })
      const raw = await readFile(filePath, 'utf8')
      const text = raw.replace(/^\uFEFF/, '').trim()
      if (!text) {
        throw new Error('文档内容为空')
      }

      this.emitProgress({ stage: 'chunk', message: '正在切分文档…' })
      const chunks = this.chunkDocument(text)
      if (chunks.length === 0) {
        throw new Error('切分后没有有效段落')
      }
      const total = chunks.length
      this.emitProgress({
        stage: 'chunk',
        message: `已切分为 ${total} 段`,
        current: total,
        total
      })

      const segmentSummaries: string[] = []
      for (let i = 0; i < chunks.length; i += 1) {
        this.emitProgress({
          stage: 'segment',
          message: `分段摘要 ${i + 1}/${total}…`,
          current: i + 1,
          total
        })
        const s = await summarizeDocumentSegment(chunks[i] ?? '')
        segmentSummaries.push(s || (chunks[i] ?? '').slice(0, 200))
      }

      this.emitProgress({ stage: 'merge', message: '正在生成整篇摘要…' })
      const summary = await mergeDocumentSegmentSummaries(segmentSummaries)
      if (!summary.trim()) {
        throw new Error('模型返回的整篇摘要为空')
      }

      const batchSize = RAG_INGEST_EMBEDDING_BATCH_SIZE
      const chunkPayloads: Array<{
        id: string
        document_id: string
        chunk_index: number
        content: string
        embedding: number[]
        metadata: { document_id: string; chunk_index: number; segment_summary: string }
      }> = []

      for (let start = 0; start < chunks.length; start += batchSize) {
        const end = Math.min(chunks.length, start + batchSize)
        this.emitProgress({
          stage: 'embedding',
          message: `向量嵌入 ${start + 1}–${end}/${total}…`,
          current: end,
          total
        })
        const slice = chunks.slice(start, end)
        const vectors = await this.getTextEmbedding(slice)
        if (!Array.isArray(vectors) || vectors.length !== slice.length) {
          throw new Error('批量 embedding 结果数量与切片不一致')
        }
        for (let j = 0; j < slice.length; j += 1) {
          const chunkIndex = start + j
          const embedding = vectors[j] as number[]
          chunkPayloads.push({
            id: randomUUID(),
            document_id: documentId,
            chunk_index: chunkIndex,
            content: slice[j] ?? '',
            embedding,
            metadata: {
              document_id: documentId,
              chunk_index: chunkIndex,
              segment_summary: segmentSummaries[chunkIndex] ?? ''
            }
          })
        }
      }

      this.emitProgress({
        stage: 'embedding',
        message: `正在批量写入向量库（${chunkPayloads.length} 段）…`,
        current: total,
        total
      })
      const batchSaveTimeout = Math.min(
        300_000,
        Math.max(this.timeoutMs, chunkPayloads.length * 400)
      )
      await this.postServeJson(
        '/document-chunks/batch',
        { chunks: chunkPayloads },
        batchSaveTimeout
      )

      this.emitProgress({ stage: 'mysql', message: '正在写入文档摘要到 MySQL…' })
      await this.postServeJson(
        '/documents',
        {
          id: documentId,
          title,
          file_path: filePath,
          summary,
          chunk_count: chunks.length
        },
        this.timeoutMs
      )

      this.emitProgress({ stage: 'done', message: '文档索引完成', current: total, total })
      return { documentId, title, chunkCount: chunks.length, summary }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.emitProgress({ stage: 'error', message })
      throw e
    } finally {
      this.ingestBusy = false
    }
  }

  /**
   * 智谱 GLM `text_embedding`：`input` 可为单条字符串或字符串数组（批量）；维度须与 `RAG_GLM_EMBEDDING_DIM` / 库表 `vector(N)` 一致。
   */
  async getTextEmbedding(text: string): Promise<number[]>
  async getTextEmbedding(texts: string[]): Promise<number[][]>
  async getTextEmbedding(text: string | string[]): Promise<number[] | number[][]> {
    const apiKey = resolveZhipuApiKey()
    if (!apiKey) {
      throw new Error('getTextEmbedding: ZHIPU_API_KEY / BIGMODEL_API_KEY is not set')
    }

    let input: string | string[]
    const isBatch = Array.isArray(text)
    if (isBatch) {
      const parts = text.map((t) => String(t ?? '').trim()).filter(Boolean)
      if (parts.length === 0) {
        throw new Error('getTextEmbedding: texts array is empty')
      }
      input = parts
    } else {
      const s = String(text ?? '').trim()
      if (!s) {
        throw new Error('getTextEmbedding: text is empty')
      }
      input = s
    }

    const res = await axios.post<{
      data?: { embedding?: number[]; index?: number }[]
    }>(
      GLM_EMBEDDINGS_URL,
      { model: GLM_EMBEDDING_MODEL, input },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.embeddingTimeoutMs
      }
    )

    const rows = res.data?.data
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('getTextEmbedding: empty embedding in response')
    }

    if (!isBatch) {
      return assertGlmEmbeddingVector(rows[0]?.embedding)
    }

    const n = (input as string[]).length
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    if (ordered.length !== n) {
      throw new Error(
        `getTextEmbedding: expected ${n} embeddings in response, got ${ordered.length}`
      )
    }
    return ordered.map((row) => assertGlmEmbeddingVector(row.embedding))
  }

  /**
   * 按段落优先、再按最大字符数切分，适合作为简单入库分块策略。
   */
  chunkDocument(
    text: string,
    opts?: { maxChunkChars?: number; overlapChars?: number }
  ): string[] {
    return splitDocumentIntoChunks(text, opts)
  }

  /** 将检索到的片段格式化为可拼进提示词的上下文块 */
  buildContext(hits: RagVectorHit[]): string {
    return buildRagContextFromHits(hits)
  }

  /** POST /embeddings/search */
  async vectorSearch(
    embedding: number[],
    options?: RagRetrieveOptions
  ): Promise<{ ok: true; hits: RagVectorHit[] } | { ok: false; error: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.vectorApiBase}/embeddings/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedding,
          conversationId: options?.conversationId,
          limit: options?.limit,
          minSimilarity: options?.minSimilarity,
          source: options?.source
        }),
        signal: controller.signal
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        results?: RagVectorHit[]
        error?: string
      }
      if (!res.ok) {
        return { ok: false, error: body.error ?? `HTTP ${res.status}` }
      }
      if (body.ok === false) {
        return { ok: false, error: body.error ?? 'vector search failed' }
      }
      const hits = Array.isArray(body.results) ? body.results : []
      return { ok: true, hits }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 对查询做 embedding 后走向量检索，返回命中列表 */
  async retrieve(
    query: string,
    options?: RagRetrieveOptions
  ): Promise<{ ok: true; hits: RagVectorHit[] } | { ok: false; error: string }> {
    const q = query.trim()
    if (!q) {
      return { ok: false, error: 'query is empty' }
    }
    try {
      const embedding = await this.getTextEmbedding(q)
      return this.vectorSearch(embedding, options)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }

  /**
   * 一步：检索并生成可直接注入提示的上下文字符串。
   */
  async retrieveAsContext(
    query: string,
    options?: RagRetrieveOptions
  ): Promise<{ ok: true; context: string; hits: RagVectorHit[] } | { ok: false; error: string }> {
    const r = await this.retrieve(query, options)
    if (!r.ok) {
      return r
    }
    return { ok: true, context: this.buildContext(r.hits), hits: r.hits }
  }
}

/** 主进程内统一使用的 RAG 单例，勿在多处 `new RagOperator()`。 */
export const ragOperator = new RagOperator()
