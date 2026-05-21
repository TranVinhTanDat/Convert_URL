import { ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import { appConfig } from '../src/shared/app-config.js';

const isWindows = process.platform === 'win32';
const apiPort = appConfig.apiPort;
const webPort = appConfig.webPort;
const host = appConfig.host;

const children: ChildProcess[] = [];

function pipe(name: string, child: ChildProcess) {
  child.stdout?.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
      shutdown();
    }
  });
}

function spawnChild(name: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: isWindows,
    stdio: 'pipe'
  });
  children.push(child);
  pipe(name, child);
  return child;
}

function waitForPort(port: number, hostname: string, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect({ port, host: hostname });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${hostname}:${port}`));
          return;
        }
        setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  spawnChild('API', 'tsx', ['src/server/server.ts'], { PORT: String(apiPort) });
  try {
    await waitForPort(apiPort, host);
  } catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : error}`);
    shutdown();
    process.exit(1);
  }
  spawnChild('WEB', 'vite', ['--host', host, '--port', String(webPort)]);
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : error}`);
  shutdown();
  process.exit(1);
});
