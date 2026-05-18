/** 校验用于相似度搜索的 embedding 向量入参。 */

export function validateSearchEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return { ok: false, error: 'embedding 必须是非空浮点数组' };
  }
  return { ok: true };
}
