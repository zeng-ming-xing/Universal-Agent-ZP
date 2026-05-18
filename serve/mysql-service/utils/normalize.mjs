/** 请求参数与库名规范化。 */

export function normalizePositiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const normalized = Math.trunc(n);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

export function normalizeDbName(name) {
  const db = String(name ?? '').trim();
  if (!db) return '';
  if (!/^[a-zA-Z0-9_]+$/.test(db)) {
    throw new Error('database 参数不合法，仅允许字母、数字、下划线');
  }
  return db;
}
