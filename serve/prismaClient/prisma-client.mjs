import { PrismaClient } from '@prisma/client';

// MySQL 的 BIGINT / COUNT(*) 会被 Prisma 解析为 BigInt，
// Express 默认的 JSON 序列化对 BigInt 会抛 TypeError，这里做一次全局兜底。
if (typeof BigInt.prototype.toJSON !== 'function') {
  // eslint-disable-next-line no-extend-native
  BigInt.prototype.toJSON = function toJSON() {
    const asNumber = Number(this);
    return Number.isSafeInteger(asNumber) ? asNumber : this.toString();
  };
}

// DATABASE_URL 必须由环境变量 .env 提供，不再构造默认值。
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('缺少必需的环境变量: DATABASE_URL，请在 .env 中配置');
}

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
