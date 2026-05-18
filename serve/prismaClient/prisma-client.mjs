import { PrismaClient } from '@prisma/client';
import {
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
} from '../config.mjs';

// MySQL 的 BIGINT / COUNT(*) 会被 Prisma 解析为 BigInt，
// Express 默认的 JSON 序列化对 BigInt 会抛 TypeError，这里做一次全局兜底。
if (typeof BigInt.prototype.toJSON !== 'function') {
  // eslint-disable-next-line no-extend-native
  BigInt.prototype.toJSON = function toJSON() {
    const asNumber = Number(this);
    return Number.isSafeInteger(asNumber) ? asNumber : this.toString();
  };
}

// Prisma 要求 DATABASE_URL 必须指定一个库。Agent 动态探测库表时，
// 真正访问的库由 SQL 里的 `库名.表名` 或运行时 `USE` 决定。
// 这里默认连到 'mysql' 系统库，保证连接可建立。
function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const user = encodeURIComponent(MYSQL_USER);
  const password = encodeURIComponent(MYSQL_PASSWORD);
  return `mysql://${user}:${password}@${MYSQL_HOST}:${MYSQL_PORT}/mysql?connection_limit=5`;
}

const databaseUrl = buildDatabaseUrl();
// 确保 PrismaClient 内部取到同一份 URL（未显式传入时由 schema.prisma 读取 env）。
process.env.DATABASE_URL = databaseUrl;

export const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: ['error', 'warn'],
});

/**
 * 以交互式事务包一段执行逻辑，保证内部所有 $queryRawUnsafe / $executeRawUnsafe
 * 使用同一条物理连接。`USE \`db\`` 等依赖连接会话的命令必须在这里执行。
 *
 * 注意：MySQL 进入事务后无法再执行 `SET SESSION TRANSACTION READ ONLY`，
 * 因此只读保证改由 SQL 层关键字校验 (ensureSelectSql) 兜底。
 */
export function runInDbContext(handler, options = {}) {
  const timeout = options.timeout ?? 30_000;
  const maxWait = options.maxWait ?? 5_000;
  return prisma.$transaction((tx) => handler(tx), { timeout, maxWait });
}

export async function disconnectPrisma() {
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
}
