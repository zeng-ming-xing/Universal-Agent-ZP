import {
  DEFAULT_PAGE_SIZE,
  MAX_EXECUTION_TIME_MS,
  MAX_OFFSET,
  MAX_ROWS,
} from '../../config.mjs';
import { runInDbContext } from '../../prismaClient/prisma-client.mjs';
import { deriveFieldsFromRows } from '../utils/query-result.mjs';
import { ensureSelectSql, hasUserProvidedLimit } from '../utils/sql-guards.mjs';
import { normalizeDbName, normalizePositiveInt } from '../utils/normalize.mjs';
import { listDatabases } from './schema.service.mjs';

/**
 * 在 tx 上按需 `USE` 指定库后执行一次查询。
 * database 为空时，如果 SQL 没有库前缀会触发 ER_NO_DB_ERROR，
 * 此时若可见库只有一个则自动切到那个库再试；否则提示用户显式指定。
 */
async function runSelectWithDbFallback(tx, sql, database, params = []) {
  const db = normalizeDbName(database);
  if (db) {
    await tx.$executeRawUnsafe(`USE \`${db}\``);
    return tx.$queryRawUnsafe(sql, ...params);
  }
  try {
    return await tx.$queryRawUnsafe(sql, ...params);
  } catch (error) {
    const message = String(error?.message ?? '');
    const isNoDbError =
      message.includes('ER_NO_DB_ERROR') || message.includes('No database selected');
    if (!isNoDbError) {
      throw error;
    }
    const dbs = await listDatabases(tx);
    if (dbs.length === 1) {
      await tx.$executeRawUnsafe(`USE \`${dbs[0]}\``);
      return tx.$queryRawUnsafe(sql, ...params);
    }
    throw new Error(
      `未选择数据库。请在 SQL 中使用 库名.表名，或在请求里传 database 参数。可选库：${dbs
        .slice(0, 8)
        .join(', ')}${dbs.length > 8 ? ' ...' : ''}`
    );
  }
}

/** POST /count：用 COUNT 子查询统计原始 SQL 的结果行数。 */
export async function runCount({ sql, database }) {
  const checked = ensureSelectSql(sql);
  const countSql = `SELECT COUNT(*) AS total FROM (${checked}) AS _agent_count_result`;

  return runInDbContext(
    async (tx) => {
      if (MAX_EXECUTION_TIME_MS > 0) {
        await tx.$executeRawUnsafe(`SET SESSION max_execution_time = ${MAX_EXECUTION_TIME_MS}`);
      }
      const rows = await runSelectWithDbFallback(tx, countSql, database);
      const total = rows[0]?.total ?? 0;
      return { count: Number(total) };
    },
    { timeout: Math.max(MAX_EXECUTION_TIME_MS + 5000, 15000) }
  );
}

/** POST /query：带自动分页的 SELECT 执行。 */
export async function runQuery(raw) {
  const sql = ensureSelectSql(raw?.sql);
  const database = raw?.database ? String(raw.database) : '';
  const page = normalizePositiveInt(raw?.page, 1, 1, 1_000_000);
  const pageSize = normalizePositiveInt(
    raw?.pageSize,
    DEFAULT_PAGE_SIZE,
    1,
    MAX_ROWS
  );
  const rawPaginationMode = String(raw?.paginationMode ?? 'auto').toLowerCase();
  const paginationMode =
    rawPaginationMode === 'always' || rawPaginationMode === 'never'
      ? rawPaginationMode
      : 'auto';
  const offset = (page - 1) * pageSize;
  if (offset > MAX_OFFSET) {
    throw new Error(`分页偏移过大，当前最大允许 offset=${MAX_OFFSET}`);
  }

  return runInDbContext(
    async (tx) => {
      // sql_select_limit / max_execution_time 是 SESSION 变量，进入事务后依然可设置。
      // READ ONLY 事务无法在事务开启后切换，这里依赖 SQL 层 ensureSelectSql 兜底。
      await tx.$executeRawUnsafe(`SET SESSION sql_select_limit = ${MAX_ROWS}`);
      if (MAX_EXECUTION_TIME_MS > 0) {
        await tx.$executeRawUnsafe(`SET SESSION max_execution_time = ${MAX_EXECUTION_TIME_MS}`);
      }

      const hasLimit = hasUserProvidedLimit(sql);
      let rows;
      let slicedRows = [];
      let hasMore = false;
      let shouldPaginate = false;
      let paginationReason = 'auto_small_result';
      let probeRows = null;

      if (paginationMode === 'never') {
        shouldPaginate = false;
        paginationReason = 'forced_never';
      } else if (paginationMode === 'always') {
        shouldPaginate = true;
        paginationReason = 'forced_always';
      } else if (hasLimit) {
        shouldPaginate = false;
        paginationReason = 'user_sql_has_limit';
      } else if (page > 1) {
        shouldPaginate = true;
        paginationReason = 'explicit_page_gt_1';
      } else {
        const probeSql = `SELECT * FROM (${sql}) AS _agent_probe_result LIMIT ? OFFSET 0`;
        probeRows = await runSelectWithDbFallback(tx, probeSql, database, [
          pageSize + 1,
        ]);
        if (probeRows.length > pageSize) {
          shouldPaginate = true;
          paginationReason = 'auto_large_result';
        } else {
          shouldPaginate = false;
          paginationReason = 'auto_small_result';
          rows = probeRows;
          slicedRows = probeRows;
          hasMore = false;
        }
      }

      if (shouldPaginate) {
        const pagedSql = `SELECT * FROM (${sql}) AS _agent_paged_result LIMIT ? OFFSET ?`;
        // 多取 1 行用于判断是否还有下一页，避免额外 COUNT(*) 开销。
        if (paginationMode === 'auto' && page === 1 && probeRows) {
          rows = probeRows;
        } else {
          rows = await runSelectWithDbFallback(tx, pagedSql, database, [
            pageSize + 1,
            offset,
          ]);
        }
        hasMore = rows.length > pageSize;
        slicedRows = hasMore ? rows.slice(0, pageSize) : rows;
      } else if (!rows) {
        rows = await runSelectWithDbFallback(tx, sql, database);
        slicedRows = rows;
        hasMore = false;
      }

      return {
        maxRows: MAX_ROWS,
        page,
        pageSize,
        rowCount: slicedRows.length,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
        paginated: shouldPaginate,
        paginationMode,
        paginationReason,
        rows: slicedRows,
        fields: deriveFieldsFromRows(slicedRows),
      };
    },
    { timeout: Math.max(MAX_EXECUTION_TIME_MS + 5000, 30000) }
  );
}
