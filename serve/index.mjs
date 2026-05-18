// HTTP 服务启动入口（原 mysql-service.mjs）。
// 应用装配见 ./createServer.mjs；MySQL / 向量能力按 MVC 拆在 mysql-service、postgres-service 下。

import { PORT, MYSQL_HOST, MYSQL_PORT } from './config.mjs';
import { createServer } from './createServer.mjs';
import { disconnectPrisma, prisma } from './prismaClient/prisma-client.mjs';
import { disconnectVectorPrisma, vectorPrisma } from './prismaClient/vector-prisma-client.mjs';

const app = createServer();

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[serve] listening on http://127.0.0.1:${PORT} (mysql: ${MYSQL_HOST}:${MYSQL_PORT})`
  );
});

async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[serve] received ${signal}, shutting down...`);
  server.close();
  await disconnectPrisma();
  await disconnectVectorPrisma();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

prisma
  .$queryRawUnsafe('SELECT 1')
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('[serve] prisma (MySQL) connection OK');
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[serve] prisma (MySQL) connection FAILED:', e?.message ?? e);
  });

vectorPrisma
  .$queryRawUnsafe('SELECT 1')
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('[serve] vectorPrisma (PostgreSQL) connection OK');
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[serve] vectorPrisma (PostgreSQL) connection FAILED:', e?.message ?? e);
  });
