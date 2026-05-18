// mysql-service 运行期配置（均来自环境变量）。
// 单独抽出来方便其它模块复用，避免环境变量读取散落在各处。
//
// 这里在最顶部加载 .env，保证 `node ./serve/index.mjs` 直接启动时
// 也能读到根目录的 .env（与 Prisma CLI 行为一致）。
import 'dotenv/config';

export const MYSQL_HOST = process.env.MYSQL_HOST ?? '127.0.0.1';
export const MYSQL_PORT = Number(process.env.MYSQL_PORT ?? '5000');
export const MYSQL_USER = process.env.MYSQL_USER ?? 'root';
export const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? '123456';

export const FILTER_SYSTEM_DATABASES =
  String(process.env.AGENT_MYSQL_FILTER_SYSTEM_DATABASES ?? 'true') === 'true';
export const INCLUDE_VIEWS_IN_SCHEMA =
  String(process.env.AGENT_MYSQL_INCLUDE_VIEWS ?? 'false') === 'true';

export const PORT = Number(process.env.AGENT_MYSQL_SERVICE_PORT ?? '37123');
export const MAX_ROWS = Number(process.env.AGENT_MYSQL_MAX_ROWS ?? '1000');
export const DEFAULT_PAGE_SIZE = Number(
  process.env.AGENT_MYSQL_DEFAULT_PAGE_SIZE ?? '200'
);
export const MAX_OFFSET = Number(process.env.AGENT_MYSQL_MAX_OFFSET ?? '200000');
export const MAX_EXECUTION_TIME_MS = Number(
  process.env.AGENT_MYSQL_MAX_EXECUTION_TIME_MS ?? '15000'
);

export const SYSTEM_DATABASES = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
]);

// ========== PostgreSQL 向量库（pgvector） ==========
export const VECTOR_DATABASE_URL =
  process.env.VECTOR_DATABASE_URL ??
  'postgresql://root:123456@localhost:5432/postgres?schema=public&connection_limit=5';

/** 向量相似度搜索默认返回 top N 结果 */
export const VECTOR_SEARCH_DEFAULT_LIMIT = 10;

/** 向量相似度搜索最大返回条数 */
export const VECTOR_SEARCH_MAX_LIMIT = 100;
