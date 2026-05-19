import { spawn } from 'node:child_process';
import { appConfig } from '../src/shared/app-config';

const isWindows = process.platform === 'win32';

const commands = [
  {
    name: 'API',
    command: 'tsx',
    args: ['src/server/server.ts'],
    env: {
      PORT: String(appConfig.apiPort)
    }
  },
  {
    name: 'WEB',
    command: 'vite',
    args: ['--host', appConfig.host, '--port', String(appConfig.webPort)]
  }
];

const children = commands.map((item) => {
  const child = spawn(item.command, item.args, {
    env: { ...process.env, ...item.env },
    shell: isWindows,
    stdio: 'pipe'
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${item.name}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${item.name}] ${chunk}`);
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
      children.forEach((running) => running.kill());
    }
  });

  return child;
});

function shutdown() {
  children.forEach((child) => child.kill());
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
