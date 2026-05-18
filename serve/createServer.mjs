import cors from 'cors';
import express from 'express';
import { createMysqlRouter } from './mysql-service/routes/mysql.routes.mjs';
import { createVectorRouter } from './postgres-service/routes/embedding.routes.mjs';
import { prisma } from './prismaClient/prisma-client.mjs';
import { vectorPrisma } from './prismaClient/vector-prisma-client.mjs';

// function createHealthRouter(mysqlPrisma) {
//   const router = Router();
//   router.get('/health', async (_req, res) => {
//     try {
//       await mysqlPrisma.$queryRawUnsafe('SELECT 1');
//       res.json({ ok: true });
//     } catch (e) {
//       jsonError(res, 500, '数据库连接失败', { message: String(e?.message ?? e) });
//     }
//   });
//   return router;
// }

export function createServer() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '20mb' }));

  // app.use(createHealthRouter(prisma));
  app.use(createMysqlRouter({ prisma }));
  app.use(createVectorRouter({ vectorPrisma }));

  return app;
}
