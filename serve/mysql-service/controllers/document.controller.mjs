import { listDocuments, upsertDocument } from '../services/document.service.mjs';
import { jsonError } from '../utils/http-error.mjs';

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient }} deps
 */
export function createDocumentHandlers({ prisma }) {
  return {
    /** GET /documents */
    async list(_req, res) {
      try {
        const result = await listDocuments(prisma);
        if (!result.ok) {
          return jsonError(res, 500, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '获取文档列表失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /documents */
    async save(req, res) {
      try {
        const result = await upsertDocument(prisma, req.body ?? {});
        if (!result.ok) {
          return jsonError(res, 400, result.error);
        }
        res.json(result);
      } catch (e) {
        jsonError(res, 500, '保存文档失败', { message: String(e?.message ?? e) });
      }
    },
  };
}
