/**
 * 基于第一行 row 推导 fields 结构（仅含 name）。
 * Prisma 的 $queryRawUnsafe 不返回列元信息，相比 mysql2 会丢失
 * orgTable/orgName/columnType 等字段；保留 name 以维持调用方兼容。
 */
export function deriveFieldsFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  const first = rows[0];
  if (!first || typeof first !== 'object') {
    return [];
  }
  return Object.keys(first).map((name) => ({
    name,
    columnType: null,
    type: null,
    table: null,
    orgTable: null,
    orgName: name,
  }));
}
