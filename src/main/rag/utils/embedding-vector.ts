import { RAG_GLM_EMBEDDING_DIM } from '../config'

/** 校验智谱返回的单条向量维度与当前 RAG 配置一致 */
export function assertGlmEmbeddingVector(vec: number[] | undefined): number[] {
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error('getTextEmbedding: empty embedding in response')
  }
  if (vec.length !== RAG_GLM_EMBEDDING_DIM) {
    throw new Error(
      `getTextEmbedding: API 返回 ${vec.length} 维，与 RAG_GLM_EMBEDDING_DIM=${RAG_GLM_EMBEDDING_DIM} 不一致；` +
        '请设置环境变量 RAG_EMBEDDING_DIM 与模型输出一致，并保证 prisma/vector.prisma 中 vector(N) 的 N 相同，然后执行 prisma db push（向量列维度错误会导致无法写入 Postgres）。'
    )
  }
  return vec
}
