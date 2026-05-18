// mysql-service 运行期配置（均来自环境变量 .env，无默认值）。
// 单独抽出来方便其它模块复用，避免环境变量读取散落在各处。
//
// 这里在最顶部加载 .env，保证 `node ./serve/index.mjs` 直接启动时
// 也能读到根目录的 .env（与 Prisma CLI 行为一致）。
import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || value === '') {
    throw new Error(`缺少必需的环境变量: ${name}，请在 .env 中配置`);
  }
  return value;
}

export const MYSQL_HOST = requireEnv('MYSQL_HOST');
export const MYSQL_PORT = Number(requireEnv('MYSQL_PORT'));
export const MYSQL_USER = requireEnv('MYSQL_USER');
export const MYSQL_PASSWORD = requireEnv('MYSQL_PASSWORD');

export const FILTER_SYSTEM_DATABASES =
  String(process.env.AGENT_MYSQL_FILTER_SYSTEM_DATABASES) === 'true';
export const INCLUDE_VIEWS_IN_SCHEMA =
  String(process.env.AGENT_MYSQL_INCLUDE_VIEWS) === 'true';

export const PORT = Number(process.env.AGENT_MYSQL_SERVICE_PORT);
export const MAX_ROWS = Number(process.env.AGENT_MYSQL_MAX_ROWS);
export const DEFAULT_PAGE_SIZE = Number(process.env.AGENT_MYSQL_DEFAULT_PAGE_SIZE);
export const MAX_OFFSET = Number(process.env.AGENT_MYSQL_MAX_OFFSET);
export const MAX_EXECUTION_TIME_MS = Number(
  process.env.AGENT_MYSQL_MAX_EXECUTION_TIME_MS
);

export const SYSTEM_DATABASES = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
]);

// ========== PostgreSQL 向量库（pgvector） ==========
export const VECTOR_DATABASE_URL = requireEnv('VECTOR_DATABASE_URL');

/** 向量相似度搜索默认返回 top N 结果 */
export const VECTOR_SEARCH_DEFAULT_LIMIT = Number(
  process.env.VECTOR_SEARCH_DEFAULT_LIMIT
);

/** 向量相似度搜索最大返回条数 */
export const VECTOR_SEARCH_MAX_LIMIT = Number(
  process.env.VECTOR_SEARCH_MAX_LIMIT
);
