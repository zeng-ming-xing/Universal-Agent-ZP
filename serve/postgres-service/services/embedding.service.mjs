// 向量库嵌入（embedding）存储：agent_message_embeddings 的 CRUD 与相似度搜索。
// 所有函数接受 vectorPrisma，由调用方注入。

import {
  VECTOR_SEARCH_DEFAULT_LIMIT,
  VECTOR_SEARCH_MAX_LIMIT,
} from '../../config.mjs';
import { toBigIntMessageId } from '../utils/message-id.mjs';
import { clampEmbeddingSearchLimit } from '../utils/search-limit.mjs';
import { validateSearchEmbedding } from '../utils/vector-guards.mjs';
import { formatVectorLiteral } from '../utils/vector-literal.mjs';

/**
 * 保存（创建或更新）一条消息的向量嵌入。
 * 以 message_id 为唯一键 upsert，一条消息最多一条向量记录。
 *
 * @param {import('../../../node_modules/.prisma/vector-client/index.js').PrismaClient} vectorPrisma
 * @param {Object} data
 * @returns {Promise<{ok: boolean, record?: Object, error?: string}>}
 */
export async function saveEmbedding(vectorPrisma, data) {
  const { message_id, conversation_id, role, content, embedding, metadata } = data;

  if (message_id == null) {
    return { ok: false, error: 'message_id 不能为空' };
  }

  const mid = toBigIntMessageId(message_id);

  try {
    const embeddingSql =
      Array.isArray(embedding) && embedding.length > 0 ? formatVectorLiteral(embedding) : null;

    const record = await vectorPrisma.$executeRawUnsafe(
      `INSERT INTO agent_message_embeddings
         (message_id, conversation_id, role, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
       ON CONFLICT (message_id)
       DO UPDATE SET
         conversation_id = EXCLUDED.conversation_id,
         role            = EXCLUDED.role,
         content         = EXCLUDED.content,
         embedding       = EXCLUDED.embedding,
         metadata        = EXCLUDED.metadata,
         created_at      = NOW()`,
      mid,
      conversation_id ?? '',
      role ?? 'user',
      content ?? '',
      embeddingSql,
      metadata ? JSON.stringify(metadata) : null
    );

    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * 根据 message_id 获取单条嵌入记录。
 */
export async function getEmbeddingByMessageId(vectorPrisma, messageId) {
  const mid = toBigIntMessageId(messageId);

  try {
    const record = await vectorPrisma.agent_message_embeddings.findUnique({
      where: { message_id: mid },
    });
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * 列出某个会话下所有嵌入记录（按创建时间升序）。
 */
export async function listEmbeddingsByConversation(vectorPrisma, conversationId) {
  if (!conversationId) {
    return { ok: false, error: 'conversation_id 不能为空' };
  }

  try {
    const records = await vectorPrisma.agent_message_embeddings.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
    });
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * 删除单条消息的嵌入记录。
 */
export async function deleteEmbeddingByMessageId(vectorPrisma, messageId) {
  const mid = toBigIntMessageId(messageId);

  try {
    await vectorPrisma.agent_message_embeddings.delete({
      where: { message_id: mid },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * 删除某个会话下的所有嵌入记录。
 */
export async function deleteEmbeddingsByConversation(vectorPrisma, conversationId) {
  if (!conversationId) {
    return { ok: false, error: 'conversation_id 不能为空' };
  }

  try {
    await vectorPrisma.agent_message_embeddings.deleteMany({
      where: { conversation_id: conversationId },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * 向量相似度搜索：基于余弦距离（<=>）查找与给定向量最相似的 N 条记录。
 *
 * pgvector <=> 运算符返回余弦距离（0=完全相同，2=完全相反），
 * 转换为相似度 = 1 - 余弦距离，结果按相似度降序排列。
 */
/**
 * 保存知识文档分段的向量嵌入（与 MySQL agent_documents.id 对齐）。
 * @param {import('../../../node_modules/.prisma/vector-client/index.js').PrismaClient} vectorPrisma
 */
export async function saveDocumentChunkEmbedding(vectorPrisma, data) {
  const { id, document_id, chunk_index, content, embedding, metadata } = data;

  if (!document_id) {
    return { ok: false, error: 'document_id 不能为空' };
  }
  if (chunk_index == null || Number.isNaN(Number(chunk_index))) {
    return { ok: false, error: 'chunk_index 无效' };
  }

  const chunkIdx = Math.floor(Number(chunk_index));
  const chunkId = String(id ?? '').trim();
  if (!chunkId) {
    return { ok: false, error: 'id（chunk 记录 UUID）不能为空' };
  }

  try {
    const embeddingSql =
      Array.isArray(embedding) && embedding.length > 0 ? formatVectorLiteral(embedding) : null;

    if (embeddingSql == null) {
      await vectorPrisma.$executeRawUnsafe(
        `INSERT INTO agent_document_chunk_embeddings
           (id, document_id, chunk_index, content, embedding, metadata)
         VALUES ($1::uuid, $2, $3, $4, NULL, $5::jsonb)
         ON CONFLICT (document_id, chunk_index)
         DO UPDATE SET
           content    = EXCLUDED.content,
           embedding  = EXCLUDED.embedding,
           metadata   = EXCLUDED.metadata,
           created_at = NOW()`,
        chunkId,
        String(document_id),
        chunkIdx,
        content ?? '',
        metadata ? JSON.stringify(metadata) : null
      );
    } else {
      await vectorPrisma.$executeRawUnsafe(
        `INSERT INTO agent_document_chunk_embeddings
           (id, document_id, chunk_index, content, embedding, metadata)
         VALUES ($1::uuid, $2, $3, $4, $5::text::vector, $6::jsonb)
         ON CONFLICT (document_id, chunk_index)
         DO UPDATE SET
           content    = EXCLUDED.content,
           embedding  = EXCLUDED.embedding,
           metadata   = EXCLUDED.metadata,
           created_at = NOW()`,
        chunkId,
        String(document_id),
        chunkIdx,
        content ?? '',
        embeddingSql,
        metadata ? JSON.stringify(metadata) : null
      );
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * 批量 upsert 知识文档分段向量（一次 HTTP 对应多条 INSERT）。
 * body: `{ chunks: [{ id, document_id, chunk_index, content, embedding, metadata }, ...] }`
 *
 * @param {import('../../../node_modules/.prisma/vector-client/index.js').PrismaClient} vectorPrisma
 * @param {Array<Object>} chunks
 * @returns {Promise<{ ok: true, count: number } | { ok: false, error: string }>}
 */
export async function saveDocumentChunkEmbeddingsBatch(vectorPrisma, chunks) {
  if (!Array.isArray(chunks)) {
    return { ok: false, error: 'chunks 必须为数组' };
  }
  if (chunks.length === 0) {
    return { ok: false, error: 'chunks 不能为空' };
  }

  /** 先校验并规范化，避免事务中途失败；需有 @@unique([document_id, chunk_index]) 才能 ON CONFLICT */
  const rows = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const data = chunks[i];
    const { id, document_id, chunk_index, content, embedding, metadata } = data ?? {};

    if (!document_id) {
      return { ok: false, error: `chunks[${i}]: document_id 不能为空` };
    }
    if (chunk_index == null || Number.isNaN(Number(chunk_index))) {
      return { ok: false, error: `chunks[${i}]: chunk_index 无效` };
    }

    const chunkIdx = Math.floor(Number(chunk_index));
    const chunkId = String(id ?? '').trim();
    if (!chunkId) {
      return { ok: false, error: `chunks[${i}]: id（chunk 记录 UUID）不能为空` };
    }

    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, error: `chunks[${i}]: embedding 必须为非空数组` };
    }

    const embeddingLiteral = formatVectorLiteral(embedding);
    rows.push({
      chunkId,
      documentId: String(document_id),
      chunkIdx,
      content: content ?? '',
      embeddingLiteral,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
    });
  }

  const sql = `INSERT INTO agent_document_chunk_embeddings
         (id, document_id, chunk_index, content, embedding, metadata)
       VALUES ($1::uuid, $2, $3, $4, $5::text::vector, $6::jsonb)
       ON CONFLICT (document_id, chunk_index)
       DO UPDATE SET
         content    = EXCLUDED.content,
         embedding  = EXCLUDED.embedding,
         metadata   = EXCLUDED.metadata,
         created_at = NOW()`;

  /** 数组式 $transaction 默认约 5s 超时，chunk 多时整批回滚；交互式事务可拉长 timeout */
  const txTimeout = Math.min(600_000, Math.max(45_000, rows.length * 750));

  try {
    await vectorPrisma.$transaction(
      async (tx) => {
        for (const r of rows) {
          await tx.$executeRawUnsafe(
            sql,
            r.chunkId,
            r.documentId,
            r.chunkIdx,
            r.content,
            r.embeddingLiteral,
            r.metadataJson
          );
        }
      },
      { maxWait: 20_000, timeout: txTimeout }
    );
    return { ok: true, count: rows.length };
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.log('error save document chunk embeddings batch', msg)
    if (msg.includes('no unique or exclusion constraint matching the ON CONFLICT specification')) {
      return {
        ok: false,
        error:
          'PostgreSQL 表缺少 (document_id, chunk_index) 唯一约束，无法 UPSERT。请在向量库执行: pnpm exec prisma db push --schema prisma/vector.prisma',
      };
    }
    return { ok: false, error: msg };
  }
}

function mapSearchHitRow(row) {
  return {
    record: {
      id: row.id,
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      metadata: row.metadata,
      created_at: row.created_at,
    },
    similarity: Number(row.similarity),
  };
}

/**
 * 仅检索 agent_message_embeddings。
 */
async function searchMessageEmbeddingsOnly(vectorPrisma, vectorStr, options) {
  const limit = clampEmbeddingSearchLimit(
    options.limit,
    VECTOR_SEARCH_DEFAULT_LIMIT,
    VECTOR_SEARCH_MAX_LIMIT
  );
  let sql;
  let params;

  if (options.conversationId) {
    sql = `
      SELECT
        id, message_id, conversation_id, role, content, metadata, created_at,
        1 - (embedding <=> $1::vector) AS similarity
      FROM agent_message_embeddings
      WHERE embedding IS NOT NULL
        AND conversation_id = $2
        AND 1 - (embedding <=> $1::vector) >= $3
      ORDER BY embedding <=> $1::vector
      LIMIT $4
    `;
    params = [vectorStr, options.conversationId, options.minSimilarity ?? -1, limit];
  } else {
    sql = `
      SELECT
        id, message_id, conversation_id, role, content, metadata, created_at,
        1 - (embedding <=> $1::vector) AS similarity
      FROM agent_message_embeddings
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> $1::vector) >= $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;
    params = [vectorStr, options.minSimilarity ?? -1, limit];
  }

  const rows = await vectorPrisma.$queryRawUnsafe(sql, ...params);
  return (rows ?? []).map((row) => mapSearchHitRow(row));
}

/**
 * 仅检索 agent_document_chunk_embeddings（知识文档分段）。
 */
async function searchDocumentChunksOnly(vectorPrisma, vectorStr, options) {
  const limit = clampEmbeddingSearchLimit(
    options.limit,
    VECTOR_SEARCH_DEFAULT_LIMIT,
    VECTOR_SEARCH_MAX_LIMIT
  );
  const sql = `
    SELECT
      id,
      NULL::bigint AS message_id,
      document_id AS conversation_id,
      'document'::text AS role,
      content,
      metadata,
      created_at,
      1 - (embedding <=> $1::vector) AS similarity
    FROM agent_document_chunk_embeddings
    WHERE embedding IS NOT NULL
      AND 1 - (embedding <=> $1::vector) >= $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `;
  const params = [vectorStr, options.minSimilarity ?? -1, limit];
  const rows = await vectorPrisma.$queryRawUnsafe(sql, ...params);
  return (rows ?? []).map((row) => mapSearchHitRow(row));
}

/**
 * 向量相似度搜索：基于余弦距离（<=>）查找与给定向量最相似的 N 条记录。
 *
 * pgvector <=> 运算符返回余弦距离（0=完全相同，2=完全相反），
 * 转换为相似度 = 1 - 余弦距离，结果按相似度降序排列。
 *
 * 未指定 conversationId 时，合并「对话消息向量」与「知识文档分段向量」后再取 TopN。
 */
export async function searchSimilar(vectorPrisma, embedding, options = {}) {
  const check = validateSearchEmbedding(embedding);
  if (!check.ok) {
    return check;
  }

  const limit = clampEmbeddingSearchLimit(
    options.limit,
    VECTOR_SEARCH_DEFAULT_LIMIT,
    VECTOR_SEARCH_MAX_LIMIT
  );
  const vectorStr = formatVectorLiteral(embedding);
  /** @type {'all' | 'messages' | 'documents' | undefined} */
  const source = options.source;

  try {
    if (source === 'documents') {
      const results = await searchDocumentChunksOnly(vectorPrisma, vectorStr, {
        ...options,
        limit,
      });
      return { ok: true, results };
    }

    if (source === 'messages') {
      const results = await searchMessageEmbeddingsOnly(vectorPrisma, vectorStr, {
        ...options,
        limit,
      });
      return { ok: true, results };
    }

    if (options.conversationId) {
      const results = await searchMessageEmbeddingsOnly(vectorPrisma, vectorStr, {
        ...options,
        limit,
      });
      return { ok: true, results };
    }

    const [msgHits, docHits] = await Promise.all([
      searchMessageEmbeddingsOnly(vectorPrisma, vectorStr, {
        ...options,
        limit,
      }),
      searchDocumentChunksOnly(vectorPrisma, vectorStr, {
        ...options,
        limit,
      }).catch(() => []),
    ]);

    const merged = [...msgHits, ...docHits]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return { ok: true, results: merged };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
