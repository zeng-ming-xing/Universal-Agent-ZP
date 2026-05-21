/**
 * 须与 `prisma/vector.prisma` 里 `vector(N)` 的 N 以及实际嵌入模型输出维度一致。
 * 智谱常见 `text_embedding` 为 **1024**；若改为 1536 等，请同步改 schema 并 `pnpm exec prisma db push --schema prisma/vector.prisma`。
 */
export const RAG_GLM_EMBEDDING_DIM = (() => {
  const raw = process.env.RAG_EMBEDDING_DIM;
  if (raw == null || raw.trim() === '') {
    return 1024;
  }
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1024;
})();

export const GLM_EMBEDDINGS_URL =
  process.env.ZHIPU_EMBEDDINGS_URL ?? 'https://open.bigmodel.cn/api/paas/v4/embeddings';

export const GLM_EMBEDDING_MODEL = process.env.ZHIPU_EMBEDDING_MODEL ?? 'embedding-2';

export function resolveZhipuApiKey(): string {
  return process.env.ZHIPU_EMBEDDINGS_KEY ?? '';
}

/** 向量 HTTP 服务根地址（与 mysql-service 同端口，见 serve/createServer.mjs） */
export function defaultVectorApiBase(): string {
  return `http://127.0.0.1:${process.env.AGENT_MYSQL_SERVICE_PORT}`;
}

/** 允许入库的文档扩展名（小写比较） */
export const ALLOWED_DOC_EXT = new Set(['.md', '.markdown', '.txt']);

/** 本地向量 / 文档 API 默认超时（ms） */
export const RAG_DEFAULT_SERVE_TIMEOUT_MS = Number(
  process.env.RAG_DEFAULT_SERVE_TIMEOUT_MS
);

/** 智谱 embedding 请求默认超时（ms） */
export const RAG_DEFAULT_EMBEDDING_TIMEOUT_MS = Number(
  process.env.RAG_DEFAULT_EMBEDDING_TIMEOUT_MS
);

/** 入库时单次请求智谱 embedding 的批大小 */
export const RAG_INGEST_EMBEDDING_BATCH_SIZE = Number(
  process.env.RAG_INGEST_EMBEDDING_BATCH_SIZE
);
