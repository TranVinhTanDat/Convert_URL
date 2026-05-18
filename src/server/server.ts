import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appConfig, getApiOrigin } from '../shared/app-config.js';

type OutputFormat = 'mp4' | 'mp3';
type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

interface JobOptions {
  url: string;
  format: OutputFormat;
  quality: string;
  playlist: 'single' | 'playlist';
  filename: 'title' | 'id';
  compatibility: boolean;
}

interface JobFile {
  fileName: string;
  title: string;
  size: number;
  downloadUrl: string;
}

interface ConvertJob {
  id: string;
  status: JobStatus;
  progress: number;
  step: string;
  logs: string[];
  files: JobFile[];
  error: string | null;
  options: JobOptions;
  createdAt: string;
  updatedAt: string;
  jobDir: string;
}

interface LocalFile {
  name: string;
  fullPath: string;
  mtimeMs: number;
  isFile: boolean;
}

interface RunOptions {
  cwd?: string;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || appConfig.apiPort);
const DIST_CLIENT_DIR = path.join(ROOT, appConfig.paths.clientDist);
const DOWNLOAD_DIR = path.join(ROOT, appConfig.paths.downloads);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const MAX_BODY_SIZE = 128 * 1024;

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const jobs = new Map<string, ConvertJob>();

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm'
};

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function sendText(res: http.ServerResponse, status: number, text: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
      if (raw.length > MAX_BODY_SIZE) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) as Record<string, unknown> : {});
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });
  });
}

function run(command: string, args: string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      options.onStderr?.(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const details = stderr.trim() || stdout.trim();
      const error = new Error(details || `${command} exited with code ${code}.`);
      reject(error);
    });
  });
}

async function hasCommand(command: string, args: string[]) {
  try {
    await run(command, args);
    return true;
  } catch {
    return false;
  }
}

function getSupportedHost(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const supported = ['youtube.com', 'youtu.be', 'music.youtube.com', 'tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'];
    return supported.find((domain) => host === domain || host.endsWith(`.${domain}`)) || null;
  } catch {
    return null;
  }
}

function normalizePayload(payload: Record<string, unknown>): JobOptions {
  const format = payload.format === 'mp3' ? 'mp3' : 'mp4';
  const quality = ['best', '2160', '1440', '1080', '720', '480', '360'].includes(String(payload.quality))
    ? String(payload.quality)
    : 'best';
  const playlist = payload.playlist === 'playlist' ? 'playlist' : 'single';
  const filename = payload.filename === 'id' ? 'id' : 'title';
  const compatibility = payload.compatibility !== 'source';

  return {
    url: String(payload.url || '').trim(),
    format,
    quality,
    playlist,
    filename,
    compatibility
  };
}

function createJob(options: JobOptions): ConvertJob {
  const id = randomUUID();
  const jobDir = path.join(DOWNLOAD_DIR, id);
  fs.mkdirSync(jobDir, { recursive: true });

  const job: ConvertJob = {
    id,
    status: 'queued',
    progress: 0,
    step: 'Queued',
    logs: [],
    files: [],
    error: null,
    options,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobDir
  };

  jobs.set(id, job);
  return job;
}

function publicJob(job: ConvertJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    step: job.step,
    logs: job.logs.slice(-80),
    files: job.files,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function updateJob(job: ConvertJob, patch: Partial<ConvertJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function addLog(job: ConvertJob, message: string) {
  const clean = String(message || '').replace(/\r/g, '').trim();
  if (!clean) return;

  clean.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed) job.logs.push(trimmed);
  });

  if (job.logs.length > 160) {
    job.logs.splice(0, job.logs.length - 160);
  }
}

function parseYtdlpProgress(job: ConvertJob, text: string) {
  addLog(job, text);

  const percentMatch = text.match(/(\d{1,3}(?:\.\d+)?)%/);
  if (percentMatch) {
    const raw = Math.min(100, Number(percentMatch[1]));
    const scaled = job.options.format === 'mp4' && job.options.compatibility
      ? Math.min(82, Math.round(raw * 0.82))
      : Math.min(95, Math.round(raw * 0.95));
    updateJob(job, { progress: Math.max(job.progress, scaled), step: 'Downloading media' });
  }

  if (/merging formats/i.test(text)) {
    updateJob(job, { progress: Math.max(job.progress, 84), step: 'Merging streams' });
  }

  if (/extracting audio|destination/i.test(text) && job.options.format === 'mp3') {
    updateJob(job, { progress: Math.max(job.progress, 86), step: 'Extracting MP3 audio' });
  }
}

function buildFormatArgs(options: JobOptions) {
  if (options.format === 'mp3') {
    return ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata', '--embed-thumbnail'];
  }

  const height = options.quality !== 'best' ? `[height<=${options.quality}]` : '';

  if (options.compatibility) {
    return [
      '-f',
      `bestvideo${height}[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best${height}[ext=mp4][vcodec^=avc1]/bestvideo${height}[ext=mp4]+bestaudio[ext=m4a]/best${height}[ext=mp4]/best${height}`,
      '--merge-output-format',
      'mp4'
    ];
  }

  return [
    '-f',
    `bestvideo${height}[ext=mp4]+bestaudio[ext=m4a]/best${height}[ext=mp4]/best${height}`,
    '--merge-output-format',
    'mp4'
  ];
}

function outputTemplate(filenameMode: JobOptions['filename']) {
  return filenameMode === 'id' ? '%(id)s.%(ext)s' : '%(title).180B [%(id)s].%(ext)s';
}

function getJobFiles(jobDir: string): LocalFile[] {
  return fs.readdirSync(jobDir)
    .map((name) => {
      const fullPath = path.join(jobDir, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs, isFile: stat.isFile() };
    })
    .filter((file) => file.isFile && !file.name.endsWith('.part') && !file.name.endsWith('.ytdl'))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

async function readStreamCodec(filePath: string, selector: string) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    selector,
    '-show_entries',
    'stream=codec_name',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);

  return stdout.trim().split('\n')[0]?.toLowerCase() || '';
}

async function transcodeMp4(job: ConvertJob, file: LocalFile) {
  const parsed = path.parse(file.fullPath);
  const tempPath = path.join(parsed.dir, `${parsed.name}.compatible-temp${parsed.ext}`);

  updateJob(job, { progress: Math.max(job.progress, 86), step: 'Converting to H.264/AAC for Windows compatibility' });
  addLog(job, `Converting ${file.name} to H.264/AAC...`);

  await run('ffmpeg', [
    '-y',
    '-i',
    file.fullPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    tempPath
  ], {
    onStderr: (text) => {
      if (/time=\d+:\d+:\d+\.\d+/.test(text)) {
        updateJob(job, { progress: Math.max(job.progress, 90), step: 'Encoding compatible MP4' });
      }
    }
  });

  fs.renameSync(tempPath, file.fullPath);
}

async function ensureCompatibleMp4(job: ConvertJob, files: LocalFile[]) {
  for (const file of files) {
    if (path.extname(file.fullPath).toLowerCase() !== '.mp4') continue;

    const videoCodec = await readStreamCodec(file.fullPath, 'v:0');
    const audioCodec = await readStreamCodec(file.fullPath, 'a:0');
    addLog(job, `Codec check: video=${videoCodec || 'none'}, audio=${audioCodec || 'none'}`);

    if (videoCodec === 'h264' && (!audioCodec || audioCodec === 'aac')) {
      continue;
    }

    await transcodeMp4(job, file);
  }
}

function toDownloadFile(job: ConvertJob, file: LocalFile): JobFile {
  return {
    fileName: file.name,
    title: path.parse(file.name).name,
    size: fs.statSync(file.fullPath).size,
    downloadUrl: `/downloads/${job.id}/${encodeURIComponent(file.name)}`
  };
}

async function processJob(job: ConvertJob) {
  try {
    updateJob(job, { status: 'running', progress: 3, step: 'Validating URL' });

    const host = getSupportedHost(job.options.url);
    if (!host) {
      throw new Error('URL is not supported. Use a YouTube, YouTube Music, or TikTok link.');
    }

    updateJob(job, { progress: 6, step: `Preparing ${job.options.format.toUpperCase()} job` });

    const args = [
      '--encoding',
      'utf-8',
      '--js-runtimes',
      'node',
      '--remote-components',
      'ejs:github',
      '--windows-filenames',
      '--no-mtime',
      '--newline',
      '--paths',
      job.jobDir,
      job.options.playlist === 'playlist' ? '--yes-playlist' : '--no-playlist',
      ...buildFormatArgs(job.options),
      '-o',
      outputTemplate(job.options.filename),
      job.options.url
    ];

    updateJob(job, { progress: 10, step: 'Starting yt-dlp' });
    await run(YTDLP, args, {
      onStdout: (text) => parseYtdlpProgress(job, text),
      onStderr: (text) => parseYtdlpProgress(job, text)
    });

    let files = getJobFiles(job.jobDir);
    if (files.length === 0) {
      throw new Error('No output file was created.');
    }

    if (job.options.format === 'mp4' && job.options.compatibility) {
      await ensureCompatibleMp4(job, files);
      files = getJobFiles(job.jobDir);
    }

    updateJob(job, {
      status: 'completed',
      progress: 100,
      step: 'Completed',
      files: files.map((file) => toDownloadFile(job, file))
    });
  } catch (error) {
    fs.rmSync(job.jobDir, { recursive: true, force: true });
    updateJob(job, {
      status: 'failed',
      progress: 100,
      step: 'Failed',
      error: error instanceof Error ? error.message : 'Unknown conversion error.'
    });
    addLog(job, job.error || 'Unknown conversion error.');
  }
}

function serveFilePath(filePath: string, res: http.ServerResponse) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/downloads/')) {
    const requestedPath = path.resolve(ROOT, pathname.slice(1));
    const downloadsRoot = path.resolve(DOWNLOAD_DIR);

    if (requestedPath !== downloadsRoot && !requestedPath.startsWith(`${downloadsRoot}${path.sep}`)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    serveFilePath(requestedPath, res);
    return;
  }

  if (!fs.existsSync(DIST_CLIENT_DIR)) {
    sendJson(res, 404, {
      error: 'Frontend build not found. Run npm start for development or npm run build before preview.'
    });
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const requestedPath = path.resolve(DIST_CLIENT_DIR, relativePath);
  const clientRoot = path.resolve(DIST_CLIENT_DIR);

  if (requestedPath !== clientRoot && !requestedPath.startsWith(`${clientRoot}${path.sep}`)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  serveFilePath(requestedPath, res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const [ytdlpReady, ffmpegReady, ffprobeReady] = await Promise.all([
        hasCommand(YTDLP, ['--version']),
        hasCommand('ffmpeg', ['-version']),
        hasCommand('ffprobe', ['-version'])
      ]);

      sendJson(res, 200, {
        ready: ytdlpReady && ffmpegReady && ffprobeReady,
        ytdlpReady,
        ffmpegReady,
        ffprobeReady,
        nodeVersion: process.version,
        message: ytdlpReady && ffmpegReady && ffprobeReady ? 'Ready' : 'Missing required tools'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const payload = normalizePayload(await parseBody(req));
      const job = createJob(payload);
      setImmediate(() => processJob(job));
      sendJson(res, 202, publicJob(job));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const id = url.pathname.split('/').pop() || '';
      const job = jobs.get(id);

      if (!job) {
        sendJson(res, 404, { error: 'Job not found.' });
        return;
      }

      sendJson(res, 200, publicJob(job));
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Request failed.' });
  }
});

server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, () => {
  console.log(`${appConfig.appName} API is running at ${getApiOrigin()}`);
});
