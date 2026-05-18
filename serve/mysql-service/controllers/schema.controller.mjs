import { MYSQL_HOST, MYSQL_PORT } from '../../config.mjs';
import {
  buildSchemaDigest,
  buildSchemaSignature,
  listDatabases,
  listSchemaObjects,
  loadSchemaForDatabase,
} from '../services/schema.service.mjs';
import { jsonError } from '../utils/http-error.mjs';

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient }} } deps
 */
export function createSchemaHandlers({ prisma }) {
  return {
    /** POST /schema */
    async postSchema(req, res) {
      try {
        const database = req.body?.database ? String(req.body.database) : '';
        const includeColumns = req.body?.includeColumns !== false;
        const rawTables = Array.isArray(req.body?.tables) ? req.body.tables : [];

        const tableFilterByDb = new Map();
        for (const item of rawTables) {
          const raw = String(item ?? '').trim();
          if (!raw) continue;
          const parts = raw.split('.');
          const db = parts.length > 1 ? parts[0] : database;
          const table = parts.length > 1 ? parts.slice(1).join('.') : parts[0];
          if (!db || !table) continue;
          const list = tableFilterByDb.get(db) ?? [];
          list.push(table);
          tableFilterByDb.set(db, list);
        }

        const dbs = database ? [database] : await listDatabases(prisma);
        const schemas = [];
        for (const db of dbs) {
          schemas.push(
            await loadSchemaForDatabase(prisma, db, {
              includeColumns,
              tables: tableFilterByDb.get(db) ?? [],
            })
          );
        }

        res.json({
          ok: true,
          host: MYSQL_HOST,
          port: MYSQL_PORT,
          includeColumns,
          databases: schemas,
        });
      } catch (e) {
        jsonError(res, 400, '获取表结构失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /schema/signature */
    async postSchemaSignature(req, res) {
      try {
        const database = req.body?.database ? String(req.body.database) : '';
        const objects = await listSchemaObjects(prisma, database);
        const databases = new Set(objects.map((item) => item.tableSchema));
        res.json({
          ok: true,
          database: database || null,
          signature: buildSchemaSignature(objects),
          databaseCount: databases.size,
          tableCount: objects.length,
        });
      } catch (e) {
        jsonError(res, 400, '获取 schema 签名失败', { message: String(e?.message ?? e) });
      }
    },

    /** POST /schema/digest */
    async postSchemaDigest(req, res) {
      try {
        const database = req.body?.database ? String(req.body.database) : '';
        const digest = await buildSchemaDigest(prisma, database);
        res.json({ ok: true, database: database || null, ...digest });
      } catch (e) {
        jsonError(res, 400, '获取表结构摘要失败', { message: String(e?.message ?? e) });
      }
    },
  };
}
