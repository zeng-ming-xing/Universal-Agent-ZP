import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const mysqlServicePort = Number(process.env.AGENT_MYSQL_SERVICE_PORT ?? '37123');
const mysqlHost = process.env.MYSQL_HOST ?? '127.0.0.1';
const mysqlPort = process.env.MYSQL_PORT ?? '5000';
const mysqlUser = process.env.MYSQL_USER ?? 'root';
const mysqlPassword = process.env.MYSQL_PASSWORD ?? '123456';
const containerName = process.env.MYSQL_DOCKER_CONTAINER ?? 'agitated_nobel';

const sharedEnv = {
  ...process.env,
  MYSQL_HOST: mysqlHost,
  MYSQL_PORT: String(mysqlPort),
  MYSQL_USER: mysqlUser,
  MYSQL_PASSWORD: mysqlPassword,
  AGENT_MYSQL_SERVICE_PORT: String(mysqlServicePort),
  AGENT_DB_SCHEMA_ENDPOINT: `http://127.0.0.1:${mysqlServicePort}/schema`,
  AGENT_DB_QUERY_ENDPOINT: `http://127.0.0.1:${mysqlServicePort}/query`,
};

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? 'inherit',
      shell: false,
      env: options.env ?? process.env,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitForHealth(url, maxAttempts = 40, intervalMs = 250) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const resp = await fetch(url, { method: 'GET' });
      if (resp.ok) {
        return true;
      }
    } catch {
      // keep retrying
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function main() {
  console.log(`[dev] starting docker container ${containerName}...`);
  await runCommand('docker', ['start', containerName]);

  console.log(`[dev] starting mysql node service on port ${mysqlServicePort}...`);
  const logDir = path.resolve('temp');
  const logFile = path.join(logDir, 'mysql-service.log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(logFile, '');
  const logFd = fs.openSync(logFile, 'a');

  const mysqlService = spawn('node', ['./serve/mysql-service.mjs'], {
    env: sharedEnv,
    stdio: ['ignore', logFd, logFd],
    shell: false,
  });

  await new Promise((r) => setTimeout(r, 500));
  if (mysqlService.exitCode !== null) {
    const logs = fs.readFileSync(logFile, 'utf8');
    throw new Error(`[dev] mysql service start failed\n${logs}`);
  }

  console.log('[dev] waiting for mysql service health...');
  const healthy = await waitForHealth(`http://127.0.0.1:${mysqlServicePort}/health`);
  if (!healthy) {
    const logs = fs.readFileSync(logFile, 'utf8');
    mysqlService.kill();
    throw new Error(
      `[dev] mysql service not ready after 10s. logs:\n${logs || '(empty)'}`
    );
  }

  console.log(`[dev] mysql service ready (pid=${mysqlService.pid}).`);
  console.log('[dev] starting app via pnpm dev...');

  const app = spawn('pnpm', ['dev'], {
    env: sharedEnv,
    stdio: 'inherit',
    shell: true,
  });

  app.on('close', () => {
    if (!mysqlService.killed) {
      mysqlService.kill();
    }
    fs.closeSync(logFd);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

