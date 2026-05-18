/**
 * 相似度搜索返回条数：至少 1，不超过上限，缺省用 defaultLimit。
 * @param {unknown} rawLimit
 * @param {number} defaultLimit
 * @param {number} maxLimit
 */
export function clampEmbeddingSearchLimit(rawLimit, defaultLimit, maxLimit) {
  return Math.min(Math.max(1, Math.trunc(rawLimit ?? defaultLimit)), maxLimit);
}
