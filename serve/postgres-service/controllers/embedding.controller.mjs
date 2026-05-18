import {
  deleteEmbeddingByMessageId,
  deleteEmbeddingsByConversation,
  getEmbeddingByMessageId,
  listEmbeddingsByConversation,
  saveEmbedding,
  saveDocumentChunkEmbedding,
  saveDocumentChunkEmbeddingsBatch,
  searchSimilar,
} from '../services/embedding.service.mjs';
import { jsonError } from '../utils/http-error.mjs';

/**
 * @param {{ vectorPrisma: import('@prisma/client').PrismaClient }} } deps
 */
export function createEmbeddingHandlers({ vectorPrisma }) {
  return {
    /** POST /embeddings */
    async save(req, res) {
      try {
        const result = await saveEmbedding(vectorPrisma, req.body ?? {});
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '保存向量嵌入失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /document-chunks — 知识文档分段向量 upsert */
    async saveDocumentChunk(req, res) {
      try {
        const result = await saveDocumentChunkEmbedding(vectorPrisma, req.body ?? {});
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '保存文档分段向量失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /document-chunks/batch — 批量 upsert，body: { chunks: [...] } */
    async saveDocumentChunksBatch(req, res) {
      try {
        const body = req.body ?? {};
        const list = Array.isArray(body.chunks) ? body.chunks : null;
        if (!list) {
          return jsonError(res, 400, '请求体需包含非空字段 chunks（数组）');
        }
        const result = await saveDocumentChunkEmbeddingsBatch(vectorPrisma, list);
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[saveDocumentChunksBatch]', e?.message ?? e);
        return jsonError(res, 500, '批量保存文档分段向量失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /embeddings/search — 需在更泛化的 /embeddings/:id 之前注册（当前无冲突） */
    async search(req, res) {
      try {
        const { embedding, ...options } = req.body ?? {};
        /** source: all | messages | documents — documents 仅检索用户上传知识文档分段向量 */
        const result = await searchSimilar(vectorPrisma, embedding, options);
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '向量相似度搜索失败', { message: String(e?.message ?? e) });
      }
    },

    /** GET /embeddings/message/:messageId */
    async getByMessageId(req, res) {
      try {
        const messageId = String(req.params.messageId ?? '').trim();
        if (!messageId) {
          return jsonError(res, 400, 'messageId 不能为空');
        }
        const result = await getEmbeddingByMessageId(vectorPrisma, messageId);
        if (!result.ok) {
          return jsonError(res, 404, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '获取向量嵌入失败', { message: String(e?.message ?? e) });
      }
    },

    /** GET /embeddings/conversation/:conversationId */
    async listByConversation(req, res) {
      try {
        const conversationId = String(req.params.conversationId ?? '').trim();
        if (!conversationId) {
          return jsonError(res, 400, 'conversationId 不能为空');
        }
        const result = await listEmbeddingsByConversation(vectorPrisma, conversationId);
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '获取会话向量嵌入列表失败', { message: String(e?.message ?? e) });
      }
    },

    /** DELETE /embeddings/message/:messageId */
    async deleteByMessageId(req, res) {
      try {
        const messageId = String(req.params.messageId ?? '').trim();
        if (!messageId) {
          return jsonError(res, 400, 'messageId 不能为空');
        }
        const result = await deleteEmbeddingByMessageId(vectorPrisma, messageId);
        if (!result.ok) {
          return jsonError(res, 404, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '删除向量嵌入失败', { message: String(e?.message ?? e) });
      }
    },

    /** DELETE /embeddings/conversation/:conversationId */
    async deleteByConversation(req, res) {
      try {
        const conversationId = String(req.params.conversationId ?? '').trim();
        if (!conversationId) {
          return jsonError(res, 400, 'conversationId 不能为空');
        }
        const result = await deleteEmbeddingsByConversation(vectorPrisma, conversationId);
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '删除会话向量嵌入失败', { message: String(e?.message ?? e) });
      }
    },
  };
}
