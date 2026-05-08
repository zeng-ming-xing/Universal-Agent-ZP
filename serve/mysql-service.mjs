import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const MYSQL_HOST = process.env.MYSQL_HOST ?? '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT ?? '5000');
const MYSQL_USER = process.env.MYSQL_USER ?? 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? '123456';
const FILTER_SYSTEM_DATABASES =
  String(process.env.AGENT_MYSQL_FILTER_SYSTEM_DATABASES ?? 'true') === 'true';
const INCLUDE_VIEWS_IN_SCHEMA =
  String(process.env.AGENT_MYSQL_INCLUDE_VIEWS ?? 'false') === 'true';

const PORT = Number(process.env.AGENT_MYSQL_SERVICE_PORT ?? '37123');
const MAX_ROWS = Number(process.env.AGENT_MYSQL_MAX_ROWS ?? '1000');
const DEFAULT_PAGE_SIZE = Number(process.env.AGENT_MYSQL_DEFAULT_PAGE_SIZE ?? '200');
const MAX_OFFSET = Number(process.env.AGENT_MYSQL_MAX_OFFSET ?? '200000');
const MAX_EXECUTION_TIME_MS = Number(
  process.env.AGENT_MYSQL_MAX_EXECUTION_TIME_MS ?? '15000'
);

function ensureSelectSql(sql) {
  const trimmed = String(sql ?? '').trim().replace(/;+\s*$/, '');
  const lowered = trimmed.toLowerCase();
  const writeKeywords =
    /\b(insert|update|delete|alter|drop|truncate|create|replace|grant|revoke)\b/i;

  if (!lowered.startsWith('select')) {
    throw new Error('仅允许执行 SELECT 查询');
  }
  if (writeKeywords.test(trimmed)) {
    throw new Error('检测到潜在写操作，已拒绝执行');
  }
  return trimmed;
}

function jsonError(res, status, message, extra) {
  res.status(status).json({
    ok: false,
    error: message,
    ...(extra ? { extra } : {}),
  });
}

function normalizePositiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const normalized = Math.trunc(n);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function hasUserProvidedLimit(sql) {
  const normalized = String(sql ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // 识别常见 LIMIT 写法：LIMIT n / LIMIT n OFFSET m / LIMIT m,n
  return /\blimit\s+\d+(\s*,\s*\d+)?(\s+offset\s+\d+)?\s*$/.test(normalized);
}

function normalizeDbName(name) {
  const db = String(name ?? '').trim();
  if (!db) return '';
  if (!/^[a-zA-Z0-9_]+$/.test(db)) {
    throw new Error('database 参数不合法，仅允许字母、数字、下划线');
  }
  return db;
}

async function runSelectWithOptionalDb(conn, sql, database, params = []) {
  const db = normalizeDbName(database);
  if (db) {
    await conn.query(`USE \`${db}\``);
  }
  return conn.query(sql, params);
}

async function runSelectWithDbFallback(conn, sql, database, params = []) {
  try {
    return await runSelectWithOptionalDb(conn, sql, database, params);
  } catch (error) {
    const noDbError =
      (error && typeof error === 'object' ? String(error.code ?? '') : '') ===
      'ER_NO_DB_ERROR';
    if (!noDbError || database) {
      throw error;
    }
    const dbs = await listDatabases(conn);
    if (dbs.length === 1) {
      await conn.query(`USE \`${dbs[0]}\``);
      return conn.query(sql, params);
    }
    throw new Error(
      `未选择数据库。请在 SQL 中使用 库名.表名，或在请求里传 database 参数。可选库：${dbs
        .slice(0, 8)
        .join(', ')}${dbs.length > 8 ? ' ...' : ''}`
    );
  }
}

const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  multipleStatements: false,
});

async function listDatabases(conn) {
  const [rows] = await conn.query('SHOW DATABASES');
  const all = rows.map((r) => r.Database).filter(Boolean);
  if (!FILTER_SYSTEM_DATABASES) {
    return all;
  }
  const system = new Set([
    'information_schema',
    'mysql',
    'performance_schema',
  ]);
  return all.filter((db) => !system.has(db));
}

async function listSchemaObjects(conn, database) {
  const tableTypeFilter = INCLUDE_VIEWS_IN_SCHEMA ? '' : "AND TABLE_TYPE = 'BASE TABLE'";
  const params = [];
  let sql = `
    SELECT
      TABLE_SCHEMA AS tableSchema,
      TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE 1 = 1
      ${tableTypeFilter}
  `;
  if (database) {
    sql += '\n AND TABLE_SCHEMA = ?';
    params.push(database);
  }
  if (FILTER_SYSTEM_DATABASES && !database) {
    sql +=
      "\n AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema')";
  }
  sql += '\n ORDER BY TABLE_SCHEMA ASC, TABLE_NAME ASC';

  const [rows] = await conn.query(sql, params);
  return rows;
}

function buildSchemaSignature(rows) {
  const raw = rows.map((row) => `${row.tableSchema}.${row.tableName}`).join('\n');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

async function loadSchemaForDatabase(conn, database, options = {}) {
  const includeColumns = options.includeColumns !== false;
  const tableFilter = Array.isArray(options.tables) ? options.tables.filter(Boolean) : [];
  const tableTypeFilter = INCLUDE_VIEWS_IN_SCHEMA ? '' : "AND TABLE_TYPE = 'BASE TABLE'";
  const tableParams = [database, ...tableFilter];
  const tableNameFilterSql = tableFilter.length
    ? `AND TABLE_NAME IN (${tableFilter.map(() => '?').join(',')})`
    : '';
  const [tables] = await conn.query(
    `
    SELECT
      TABLE_NAME AS tableName,
      TABLE_COMMENT AS tableComment
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ?
      ${tableTypeFilter}
      ${tableNameFilterSql}
    ORDER BY TABLE_NAME ASC
    `,
    tableParams
  );

  if (!includeColumns) {
    return {
      database,
      tables: tables.map((t) => ({
        name: t.tableName,
        comment: t.tableComment ?? '',
      })),
    };
  }

  const columnNameFilterSql = tableFilter.length
    ? `AND c.TABLE_NAME IN (${tableFilter.map(() => '?').join(',')})`
    : '';
  const columnParams = [database, ...tableFilter];
  const [columns] = INCLUDE_VIEWS_IN_SCHEMA
    ? await conn.query(
        `
        SELECT
          TABLE_NAME AS tableName,
          COLUMN_NAME AS columnName,
          COLUMN_TYPE AS columnType,
          IS_NULLABLE AS isNullable,
          COLUMN_DEFAULT AS columnDefault,
          COLUMN_KEY AS columnKey,
          EXTRA AS extra,
          COLUMN_COMMENT AS columnComment,
          ORDINAL_POSITION AS ordinalPosition
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          ${tableFilter.length ? `AND TABLE_NAME IN (${tableFilter.map(() => '?').join(',')})` : ''}
        ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC
        `,
        columnParams
      )
    : await conn.query(
        `
        SELECT
          c.TABLE_NAME AS tableName,
          c.COLUMN_NAME AS columnName,
          c.COLUMN_TYPE AS columnType,
          c.IS_NULLABLE AS isNullable,
          c.COLUMN_DEFAULT AS columnDefault,
          c.COLUMN_KEY AS columnKey,
          c.EXTRA AS extra,
          c.COLUMN_COMMENT AS columnComment,
          c.ORDINAL_POSITION AS ordinalPosition
        FROM information_schema.COLUMNS c
        INNER JOIN information_schema.TABLES t
          ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
          AND t.TABLE_NAME = c.TABLE_NAME
        WHERE c.TABLE_SCHEMA = ?
          ${columnNameFilterSql}
          AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_NAME ASC, c.ORDINAL_POSITION ASC
        `,
        columnParams
      );

  const tableMap = new Map();
  for (const t of tables) {
    tableMap.set(t.tableName, {
      name: t.tableName,
      comment: t.tableComment ?? '',
      columns: [],
    });
  }

  for (const c of columns) {
    // 只填充已选中的表，防止把未通过筛选的对象（例如 VIEW）回填进来。
    if (!tableMap.has(c.tableName)) {
      continue;
    }
    tableMap.get(c.tableName).columns.push({
      name: c.columnName,
      type: c.columnType,
      nullable: c.isNullable === 'YES',
      default: c.columnDefault,
      key: c.columnKey,
      extra: c.extra,
      comment: c.columnComment ?? '',
      ordinal: c.ordinalPosition,
    });
  }

  return {
    database,
    tables: Array.from(tableMap.values()),
  };
}

async function buildSchemaDigest(conn, database) {
  const dbs = database ? [database] : await listDatabases(conn);
  if (dbs.length === 0) {
    return {
      digest: 'empty',
      databaseCount: 0,
      tableCount: 0,
      columnCount: 0,
    };
  }

  const placeholders = dbs.map(() => '?').join(',');
  const params = [...dbs];
  const [rows] = await conn.query(
    `
    SELECT
      c.TABLE_SCHEMA AS tableSchema,
      c.TABLE_NAME AS tableName,
      c.COLUMN_NAME AS columnName,
      c.COLUMN_TYPE AS columnType,
      c.IS_NULLABLE AS isNullable,
      c.COLUMN_KEY AS columnKey,
      c.EXTRA AS extra,
      c.ORDINAL_POSITION AS ordinalPosition
    FROM information_schema.COLUMNS c
    INNER JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
      AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA IN (${placeholders})
      ${INCLUDE_VIEWS_IN_SCHEMA ? '' : "AND t.TABLE_TYPE = 'BASE TABLE'"}
    ORDER BY c.TABLE_SCHEMA ASC, c.TABLE_NAME ASC, c.ORDINAL_POSITION ASC
    `,
    params
  );

  const lines = rows.map(
    (r) =>
      `${r.tableSchema}.${r.tableName}.${r.columnName}|${r.columnType}|${r.isNullable}|${r.columnKey}|${r.extra}|${r.ordinalPosition}`
  );
  const digest = crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
  const tableSet = new Set(rows.map((r) => `${r.tableSchema}.${r.tableName}`));
  return {
    digest,
    databaseCount: dbs.length,
    tableCount: tableSet.size,
    columnCount: rows.length,
  };
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  try {
    const conn = await pool.getConnection();
    try {
      await conn.query('SELECT 1');
      res.json({ ok: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    jsonError(res, 500, '数据库连接失败', { message: String(e?.message ?? e) });
  }
});

// POST /schema  { database?: string, includeColumns?: boolean, tables?: string[] }
app.post('/schema', async (req, res) => {
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

    const conn = await pool.getConnection();
    try {
      // 默认扫描所有可见库；仅在显式指定 database 时限定单库。
      const dbs = database ? [database] : await listDatabases(conn);

      const schemas = [];
      for (const db of dbs) {
        schemas.push(
          await loadSchemaForDatabase(conn, db, {
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
    } finally {
      conn.release();
    }
  } catch (e) {
    jsonError(res, 400, '获取表结构失败', { message: String(e?.message ?? e) });
  }
});

// POST /schema/signature  { database?: string }
app.post('/schema/signature', async (req, res) => {
  try {
    const database = req.body?.database ? String(req.body.database) : '';
    const conn = await pool.getConnection();
    try {
      const objects = await listSchemaObjects(conn, database);
      const databases = new Set(objects.map((item) => item.tableSchema));
      res.json({
        ok: true,
        database: database || null,
        signature: buildSchemaSignature(objects),
        databaseCount: databases.size,
        tableCount: objects.length,
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    jsonError(res, 400, '获取 schema 签名失败', { message: String(e?.message ?? e) });
  }
});

// POST /schema/digest  { database?: string }
app.post('/schema/digest', async (req, res) => {
  try {
    const database = req.body?.database ? String(req.body.database) : '';
    const conn = await pool.getConnection();
    try {
      const digest = await buildSchemaDigest(conn, database);
      res.json({
        ok: true,
        database: database || null,
        ...digest,
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    jsonError(res, 400, '获取表结构摘要失败', { message: String(e?.message ?? e) });
  }
});

// POST /count  { sql: string, database?: string }
// 返回 { ok: true, count: number } —— 用于 Agent 决策是否需要分页
app.post('/count', async (req, res) => {
  try {
    const sql = ensureSelectSql(req.body?.sql);
    const database = req.body?.database ? String(req.body.database) : '';

    // 将原始 SQL 包裹为 COUNT 子查询，避免修改原 SQL 语义
    const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS _agent_count_result`;

    const conn = await pool.getConnection();
    try {
      // 只读事务 + 执行时间限制，与 /query 保持一致
      await conn.query('SET SESSION TRANSACTION READ ONLY');
      if (MAX_EXECUTION_TIME_MS > 0) {
        await conn.query('SET SESSION max_execution_time = ?', [MAX_EXECUTION_TIME_MS]);
      }
      const [rows] = await runSelectWithDbFallback(conn, countSql, database);
      const count = Number(rows[0]?.total ?? 0);
      res.json({ ok: true, count });
    } finally {
      conn.release();
    }
  } catch (e) {
    jsonError(res, 400, 'COUNT 查询失败', { message: String(e?.message ?? e) });
  }
});

// POST /query  { sql: string, database?: string, page?: number, pageSize?: number, paginationMode?: "auto"|"always"|"never" }
app.post('/query', async (req, res) => {
  try {
    const sql = ensureSelectSql(req.body?.sql);
    const database = req.body?.database ? String(req.body.database) : '';
    const page = normalizePositiveInt(req.body?.page, 1, 1, 1000000);
    const pageSize = normalizePositiveInt(req.body?.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_ROWS);
    const rawPaginationMode = String(req.body?.paginationMode ?? 'auto').toLowerCase();
    const paginationMode =
      rawPaginationMode === 'always' || rawPaginationMode === 'never' ? rawPaginationMode : 'auto';
    const offset = (page - 1) * pageSize;
    if (offset > MAX_OFFSET) {
      throw new Error(`分页偏移过大，当前最大允许 offset=${MAX_OFFSET}`);
    }

    const conn = await pool.getConnection();
    try {
      // 进一步保证只读 + 限制行数，避免误拉爆本地
      await conn.query('SET SESSION TRANSACTION READ ONLY');
      await conn.query('SET SESSION sql_select_limit = ?', [MAX_ROWS]);
      if (MAX_EXECUTION_TIME_MS > 0) {
        await conn.query('SET SESSION max_execution_time = ?', [MAX_EXECUTION_TIME_MS]);
      }
      const hasLimit = hasUserProvidedLimit(sql);
      let rows;
      let fields;
      let hasMore = false;
      let slicedRows = [];
      let shouldPaginate = false;
      let paginationReason = 'auto_small_result';
      let probeRows = null;
      let probeFields = null;
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
        [probeRows, probeFields] = await runSelectWithDbFallback(conn, probeSql, database, [
          pageSize + 1,
        ]);
        if (probeRows.length > pageSize) {
          shouldPaginate = true;
          paginationReason = 'auto_large_result';
        } else {
          shouldPaginate = false;
          paginationReason = 'auto_small_result';
          rows = probeRows;
          fields = probeFields;
          slicedRows = probeRows;
          hasMore = false;
        }
      }
      if (shouldPaginate) {
        const pagedSql = `SELECT * FROM (${sql}) AS _agent_paged_result LIMIT ? OFFSET ?`;
        // 多取 1 行用于判断是否还有下一页，避免额外 COUNT(*) 开销。
        if (paginationMode === 'auto' && page === 1 && probeRows && probeFields) {
          rows = probeRows;
          fields = probeFields;
        } else {
          [rows, fields] = await runSelectWithDbFallback(conn, pagedSql, database, [
            pageSize + 1,
            offset,
          ]);
        }
        hasMore = rows.length > pageSize;
        slicedRows = hasMore ? rows.slice(0, pageSize) : rows;
      } else {
        if (!rows || !fields) {
          [rows, fields] = await runSelectWithDbFallback(conn, sql, database);
        }
        slicedRows = rows;
        hasMore = false;
      }
      res.json({
        ok: true,
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
        fields: fields?.map((f) => ({
          name: f.name,
          columnType: f.columnType,
          type: f.type,
          table: f.table,
          orgTable: f.orgTable,
          orgName: f.orgName,
        })),
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    jsonError(res, 400, 'SQL 执行失败', { message: String(e?.message ?? e) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[mysql-service] listening on http://127.0.0.1:${PORT} (mysql: ${MYSQL_HOST}:${MYSQL_PORT})`
  );
});

