import {
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
} from '../services/conversation.service.mjs';
import { jsonError } from '../utils/http-error.mjs';

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient }} } deps
 */
export function createConversationHandlers({ prisma }) {
  return {
    /** GET /conversations */
    async list(_req, res) {
      try {
        const result = await listConversations(prisma);
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '获取对话列表失败', { message: String(e?.message ?? e) });
      }
    },

    /** GET /conversations/:id */
    async getById(req, res) {
      try {
        const id = String(req.params.id ?? '').trim();
        if (!id) {
          return jsonError(res, 400, 'id 不能为空');
        }
        const result = await getConversation(prisma, id);
        if (!result.ok) {
          return jsonError(res, 404, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '获取对话详情失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /conversations */
    async save(req, res) {
      try {
        const result = await saveConversation(prisma, req.body ?? {});
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '保存对话失败', { message: String(e?.message ?? e) });
      }
    },

    /** DELETE /conversations/:id */
    async remove(req, res) {
      try {
        const id = String(req.params.id ?? '').trim();
        if (!id) {
          return jsonError(res, 400, 'id 不能为空');
        }
        const result = await deleteConversation(prisma, id);
        if (!result.ok) {
          return jsonError(res, 404, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '删除对话失败', { message: String(e?.message ?? e) });
      }
    },
  };
}
