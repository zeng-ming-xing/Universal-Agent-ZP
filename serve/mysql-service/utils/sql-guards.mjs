/** SELECT 安全校验、LIMIT 形态识别（与 Prisma/Express 无关）。 */

export function ensureSelectSql(sql) {
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

export function hasUserProvidedLimit(sql) {
  const normalized = String(sql ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return /\blimit\s+\d+(\s*,\s*\d+)?(\s+offset\s+\d+)?\s*$/.test(normalized);
}
