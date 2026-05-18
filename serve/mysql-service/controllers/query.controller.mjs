import { runCount, runQuery } from '../services/query.service.mjs';
import { jsonError } from '../utils/http-error.mjs';

export function createQueryHandlers() {
  return {
    /** POST /count */
    async postCount(req, res) {
      try {
        const { count } = await runCount({
          sql: req.body?.sql,
          database: req.body?.database,
        });
        res.json({ ok: true, count });
      } catch (e) {
        jsonError(res, 400, 'COUNT 查询失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /query */
    async postQuery(req, res) {
      try {
        const result = await runQuery(req.body ?? {});
        res.json({ ok: true, ...result });
      } catch (e) {
        jsonError(res, 400, 'SQL 执行失败', { message: String(e?.message ?? e) });
      }
    },
  };
}
