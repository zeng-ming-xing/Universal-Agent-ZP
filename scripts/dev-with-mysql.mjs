import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import 'dotenv/config';

// ---------------------------------------------------------------------------
// 开发一键启动脚本：
//   1. docker compose up -d 拉起 mysql + pgvector
//   2. prisma db push：按 schema 在 MySQL / Postgres 中建表（含 agent_documents 等）
//   3. 启动 mysql-service（Node Express 服务）
//   4. 启动 pnpm dev（Electron 主进程 + Vite）
//
// 若你单独跑 `pnpm dev`，请先在项目根执行（且 .env 里 DATABASE_URL / VECTOR_DATABASE_URL
// 与 serve、Electron 使用的一致）：
//   pnpm prisma:push:all
// ---------------------------------------------------------------------------

const mysqlServicePort = Number(process.env.AGENT_MYSQL_SERVICE_PORT);
const mysqlHost = process.env.MYSQL_HOST;
const mysqlPort = Number(process.env.MYSQL_PORT);
const mysqlUser = process.env.MYSQL_USER;
const mysqlPassword = process.env.MYSQL_PASSWORD;

const pgHost = '127.0.0.1';
const pgPort = Number(process.env.PG_PORT);

const databaseUrl = process.env.DATABASE_URL;

const vectorDatabaseUrl = process.env.VECTOR_DATABASE_URL;

const sharedEnv = {
  ...process.env,
  MYSQL_HOST: mysqlHost,
  MYSQL_PORT: String(mysqlPort),
  MYSQL_USER: mysqlUser,
  MYSQL_PASSWORD: mysqlPassword,
  AGENT_MYSQL_SERVICE_PORT: String(mysqlServicePort),
  AGENT_DB_SCHEMA_ENDPOINT: `http://127.0.0.1:${mysqlServicePort}/schema`,
  AGENT_DB_QUERY_ENDPOINT: `http://127.0.0.1:${mysqlServicePort}/query`,
  DATABASE_URL: databaseUrl,
  VECTOR_DATABASE_URL: vectorDatabaseUrl,
};

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? 'inherit',
      shell: options.shell ?? false,
      env: options.env ?? process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log('[dev] docker compose up -d ...');
  await runCommand('docker', ['compose', 'up', '-d']);

  // 等容器就绪，避免 prisma 首连失败
  await new Promise((r) => setTimeout(r, 2500));

  console.log('[dev] prisma db push (MySQL schema.prisma) ...');
  await runCommand('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
    env: sharedEnv,
    shell: true,
  });
  console.log('[dev] prisma db push (Postgres vector.prisma) ...');
  await runCommand(
    'pnpm',
    ['exec', 'prisma', 'db', 'push', '--schema', 'prisma/vector.prisma', '--skip-generate'],
    { env: sharedEnv, shell: true }
  );

  console.log(`[dev] starting mysql node service on port ${mysqlServicePort}...`);
  const logDir = path.resolve('temp');
  const logFile = path.join(logDir, 'mysql-service.log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(logFile, '');
  const logFd = fs.openSync(logFile, 'a');

  const mysqlService = spawn('node', ['./serve/index.mjs'], {
    env: sharedEnv,
    stdio: ['ignore', logFd, logFd],
    shell: false,
  });

  console.log('[dev] starting app via pnpm dev...');
  const app = spawn('pnpm', ['dev'], {
    env: sharedEnv,
    stdio: 'inherit',
    shell: true,
  });

  app.on('close', () => {
    if (!mysqlService.killed) mysqlService.kill();
    fs.closeSync(logFd);
    // 默认不 `docker compose down`，保留容器便于下次快速重启。
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
