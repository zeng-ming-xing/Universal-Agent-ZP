import { PrismaClient as VectorPrismaClient } from '../../node_modules/.prisma/vector-client/index.js';
import { VECTOR_DATABASE_URL } from '../config.mjs';

// 覆盖 env 以确保 PrismaClient 内部通过 env() 读取时得到同一份 URL
process.env.VECTOR_DATABASE_URL = VECTOR_DATABASE_URL;

/**
 * 向量库（PostgreSQL + pgvector）PrismaClient 单例。
 *
 * 用法：
 *   import { vectorPrisma } from '../prismaClient/vector-prisma-client.mjs';
 *   const rows = await vectorPrisma.agent_message_embeddings.findMany();
 */
export const vectorPrisma = new VectorPrismaClient({
  datasources: { db: { url: VECTOR_DATABASE_URL } },
  log: ['error', 'warn'],
});

/**
 * 断开向量库连接。
 * 通常在进程退出前调用，避免连接泄漏。
 */
export async function disconnectVectorPrisma() {
  try {
    await vectorPrisma.$disconnect();
  } catch {
    // ignore
  }
}
