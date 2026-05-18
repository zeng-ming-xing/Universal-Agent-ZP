import crypto from 'node:crypto';
import {
  FILTER_SYSTEM_DATABASES,
  INCLUDE_VIEWS_IN_SCHEMA,
  SYSTEM_DATABASES,
} from '../../config.mjs';

// 所有函数都接受一个 tx（PrismaClient 或事务上下文），便于在需要的地方
// 用 runInDbContext 把多个调用绑定在同一连接上。

export async function listDatabases(tx) {
  const rows = await tx.$queryRawUnsafe('SHOW DATABASES');
  const all = rows.map((r) => r.Database ?? r.database ?? r.DATABASE).filter(Boolean);
  if (!FILTER_SYSTEM_DATABASES) {
    return all;
  }
  return all.filter((db) => !SYSTEM_DATABASES.has(db));
}

export async function listSchemaObjects(tx, database) {
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
      "\n AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')";
  }
  sql += '\n ORDER BY TABLE_SCHEMA ASC, TABLE_NAME ASC';

  return tx.$queryRawUnsafe(sql, ...params);
}

export function buildSchemaSignature(rows) {
  const raw = rows.map((row) => `${row.tableSchema}.${row.tableName}`).join('\n');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

export async function loadSchemaForDatabase(tx, database, options = {}) {
  const includeColumns = options.includeColumns !== false;
  const tableFilter = Array.isArray(options.tables) ? options.tables.filter(Boolean) : [];
  const tableTypeFilter = INCLUDE_VIEWS_IN_SCHEMA ? '' : "AND TABLE_TYPE = 'BASE TABLE'";
  const tableParams = [database, ...tableFilter];
  const tableNameFilterSql = tableFilter.length
    ? `AND TABLE_NAME IN (${tableFilter.map(() => '?').join(',')})`
    : '';
  const tables = await tx.$queryRawUnsafe(
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
    ...tableParams
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

  const columnParams = [database, ...tableFilter];
  const columns = INCLUDE_VIEWS_IN_SCHEMA
    ? await tx.$queryRawUnsafe(
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
        ...columnParams
      )
    : await tx.$queryRawUnsafe(
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
          ${tableFilter.length ? `AND c.TABLE_NAME IN (${tableFilter.map(() => '?').join(',')})` : ''}
          AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_NAME ASC, c.ORDINAL_POSITION ASC
        `,
        ...columnParams
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
    if (!tableMap.has(c.tableName)) continue;
    tableMap.get(c.tableName).columns.push({
      name: c.columnName,
      type: c.columnType,
      nullable: c.isNullable === 'YES',
      default: c.columnDefault,
      key: c.columnKey,
      extra: c.extra,
      comment: c.columnComment ?? '',
      ordinal: Number(c.ordinalPosition),
    });
  }

  return {
    database,
    tables: Array.from(tableMap.values()),
  };
}

export async function buildSchemaDigest(tx, database) {
  const dbs = database ? [database] : await listDatabases(tx);
  if (dbs.length === 0) {
    return { digest: 'empty', databaseCount: 0, tableCount: 0, columnCount: 0 };
  }

  const placeholders = dbs.map(() => '?').join(',');
  const rows = await tx.$queryRawUnsafe(
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
    ...dbs
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
