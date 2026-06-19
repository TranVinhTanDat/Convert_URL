import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Busboy from 'busboy';
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, PageBreak, PageOrientation, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import sharp from 'sharp';
import { appConfig, getApiOrigin } from '../shared/app-config.js';
import { getNewsStore, publicArticle, refreshNewsFeed, reenrichArticle } from './content-studio/index.js';
import { fetchTranscriptWithYtdlp, humanizeYtdlpError, TranscriptResult } from './transcript.js';
import { separateStems, isDemucsReady, newStemsJobDir, StemsResult } from './stems.js';

type OutputFormat = 'mp4' | 'mp3';
type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
type FileTool =
  | 'excel-to-json'
  | 'json-to-excel'
  | 'excel-to-xml'
  | 'xml-to-excel'
  | 'excel-to-csv'
  | 'csv-to-excel'
  | 'word-to-pdf'
  | 'pdf-to-word'
  | 'image-to-png'
  | 'image-to-jpeg'
  | 'image-to-webp'
  | 'image-to-avif'
  | 'image-to-pdf'
  | 'pdf-to-png'
  | 'compress-image'
  | 'resize-image'
  | 'upscale-image'
  | 'square-thumbnail'
  | 'strip-metadata'
  | 'image-metadata'
  | 'scan-document'
  | 'ocr-translate'
  | 'caption-image'
  | 'remove-background'
  | 'remove-object'
  | 'chroma-key'
  | 'crop-image'
  | 'rotate-image'
  | 'filter-image'
  | 'merge-pdf'
  | 'split-pdf';

const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.avif'];

const fileToolExtensions: Record<FileTool, string[]> = {
  'excel-to-json': ['.xlsx'],
  'json-to-excel': ['.json'],
  'excel-to-xml': ['.xlsx'],
  'xml-to-excel': ['.xml'],
  'excel-to-csv': ['.xlsx'],
  'csv-to-excel': ['.csv'],
  'word-to-pdf': ['.doc', '.docx'],
  'pdf-to-word': ['.pdf'],
  'image-to-png': imageExtensions,
  'image-to-jpeg': imageExtensions,
  'image-to-webp': imageExtensions,
  'image-to-avif': imageExtensions,
  'image-to-pdf': imageExtensions,
  'pdf-to-png': ['.pdf'],
  'compress-image': imageExtensions,
  'resize-image': imageExtensions,
  'upscale-image': imageExtensions,
  'square-thumbnail': imageExtensions,
  'strip-metadata': imageExtensions,
  'image-metadata': imageExtensions,
  'scan-document': imageExtensions,
  'ocr-translate': imageExtensions,
  'caption-image': imageExtensions,
  'remove-background': imageExtensions,
  'remove-object': imageExtensions,
  'chroma-key': imageExtensions,
  'crop-image': imageExtensions,
  'rotate-image': imageExtensions,
  'filter-image': imageExtensions,
  'merge-pdf': ['.pdf'],
  'split-pdf': ['.pdf']
};

function isFileTool(value: string): value is FileTool {
  return Object.prototype.hasOwnProperty.call(fileToolExtensions, value);
}

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
  clientIp: string;
}

interface LocalFile {
  name: string;
  fullPath: string;
  mtimeMs: number;
  isFile: boolean;
}

interface NewsVideoRequest {
  url: string;
  format: 'short' | 'landscape';
  language: 'vi' | 'en';
  tone: 'newsroom' | 'social' | 'executive';
  autoPublish: boolean;
}

interface NewsArticle {
  url: string;
  host: string;
  title: string;
  description: string;
  siteName: string;
  author: string;
  publishedAt: string;
  imageUrl: string;
  paragraphs: string[];
}

interface StorySlide {
  label: string;
  headline: string;
  body: string[];
}

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  timeoutMs?: number;
}

interface CommandRunner {
  command: string;
  argsPrefix: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = process.cwd();
const PORT = Number(process.env.PORT || appConfig.apiPort);
const DIST_CLIENT_DIR = path.join(ROOT, appConfig.paths.clientDist);
const DOWNLOAD_DIR = path.join(ROOT, appConfig.paths.downloads);
const SOFFICE = resolveLibreOfficeCommand();
const MAX_BODY_SIZE = 128 * 1024;
const MAX_UPLOAD_SIZE = 40 * 1024 * 1024;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PUBLIC_RATE_WINDOW_MS = clampInt(process.env.PUBLIC_RATE_WINDOW_SECONDS, 3600, 60, 86400) * 1000;
const PUBLIC_RATE_MAX_JOBS = clampInt(process.env.PUBLIC_RATE_MAX_JOBS, 12, 1, 500);
const PUBLIC_MAX_ACTIVE_JOBS = clampInt(process.env.PUBLIC_MAX_ACTIVE_JOBS, 2, 1, 20);
const PUBLIC_MAX_MEDIA_SECONDS = clampInt(process.env.PUBLIC_MAX_MEDIA_SECONDS, 1800, 60, 24 * 60 * 60);
const PUBLIC_MAX_PLAYLIST_ITEMS = clampInt(process.env.PUBLIC_MAX_PLAYLIST_ITEMS, 10, 1, 100);

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const NEWS_STORE_DIR = path.join(ROOT, 'data', 'content-studio');
const NEWS_STORE_FILE = path.join(NEWS_STORE_DIR, 'news.json');
fs.mkdirSync(NEWS_STORE_DIR, { recursive: true });
const newsStore = getNewsStore(NEWS_STORE_FILE);

const jobs = new Map<string, ConvertJob>();
const mediaRateBuckets = new Map<string, number[]>();
let cachedYtdlpRunner: CommandRunner | null = null;

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
  '.webm': 'video/webm',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};

function resolveLibreOfficeCommand() {
  const configured = process.env.LIBREOFFICE_PATH || process.env.SOFFICE_PATH;
  if (configured) return configured;

  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
  ];

  const installedPath = candidates.find((candidate) => fs.existsSync(candidate));
  return installedPath || 'soffice';
}

function libreOfficeProfileArg(profileDir: string) {
  fs.mkdirSync(profileDir, { recursive: true });
  return `-env:UserInstallation=${pathToFileURL(profileDir).href}`;
}

function libreOfficeHealthArgs() {
  return [
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    libreOfficeProfileArg(path.join(DOWNLOAD_DIR, '.libreoffice-health')),
    '--version'
  ];
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders()
  });
  res.end(JSON.stringify(data));
}

function sendText(res: http.ServerResponse, status: number, text: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() });
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
      env: options.env || process.env,
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`${command} timed out after ${options.timeoutMs}ms.`));
      }, options.timeoutMs);
    }

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

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

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

async function hasCommand(command: string, args: string[], timeoutMs = 8000) {
  try {
    await run(command, args, { timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function resolveYtdlpRunner() {
  if (cachedYtdlpRunner) return cachedYtdlpRunner;

  const candidates: CommandRunner[] = process.env.YTDLP_PATH
    ? [{ command: process.env.YTDLP_PATH, argsPrefix: [] }]
    : [
      { command: 'yt-dlp', argsPrefix: [] },
      { command: 'python3', argsPrefix: ['-m', 'yt_dlp'] },
      { command: 'python', argsPrefix: ['-m', 'yt_dlp'] }
    ];

  for (const candidate of candidates) {
    if (await hasCommand(candidate.command, [...candidate.argsPrefix, '--version'], 7000)) {
      cachedYtdlpRunner = candidate;
      return candidate;
    }
  }

  throw new Error('yt-dlp is not available. Install yt-dlp or set YTDLP_PATH.');
}

function resolveYtdlpCookiesPath() {
  const directPath = String(process.env.YTDLP_COOKIES_PATH || process.env.YOUTUBE_COOKIES_PATH || '').trim();
  if (directPath && fs.existsSync(directPath)) {
    return directPath;
  }

  // Zero-config local cookies: drop a Netscape-format cookies.txt at one of these
  // paths (no env var needed) and it is used automatically. `secrets/` is gitignored.
  for (const candidate of [
    path.join(ROOT, 'secrets', 'youtube-cookies.txt'),
    path.join(ROOT, 'youtube-cookies.txt')
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const rawBase64 = String(process.env.YTDLP_COOKIES_BASE64 || process.env.YOUTUBE_COOKIES_BASE64 || '').trim();
  const rawContent = String(process.env.YTDLP_COOKIES_CONTENT || process.env.YOUTUBE_COOKIES_CONTENT || '').trim();
  if (!rawBase64 && !rawContent) {
    return null;
  }

  const cookieDir = path.join(DOWNLOAD_DIR, '.secrets');
  fs.mkdirSync(cookieDir, { recursive: true });
  const cookiePath = path.join(cookieDir, 'youtube-cookies.txt');
  const content = rawBase64
    ? Buffer.from(rawBase64, 'base64').toString('utf8')
    : rawContent.replace(/\\n/g, '\n');

  if (!content.includes('youtube.com') && !content.includes('.youtube.com')) {
    console.warn('[yt-dlp] cookies env is present but does not look like a Netscape YouTube cookies file.');
  }
  fs.writeFileSync(cookiePath, content, { encoding: 'utf8', mode: 0o600 });
  return cookiePath;
}

function ytdlpAuthArgs() {
  const args: string[] = [];
  const cookiesPath = resolveYtdlpCookiesPath();
  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  const browser = String(process.env.YTDLP_COOKIES_FROM_BROWSER || '').trim();
  if (browser) {
    args.push('--cookies-from-browser', browser);
  }

  return args;
}

// YouTube player clients used to fetch streams. The `ios` client now requires a
// GVS PO Token and yields HTTP 403 on the actual data download, so it is excluded
// by default. `web_safari` + `tv` are the most reliable PO-token-free clients as of
// mid-2026. Override via YTDLP_PLAYER_CLIENT if YouTube shifts again.
function youtubeExtractorArgs() {
  const clients = String(process.env.YTDLP_PLAYER_CLIENT || 'default,web_safari,tv').trim();
  return ['--extractor-args', `youtube:player_client=${clients}`];
}

async function hasYtdlp() {
  try {
    await resolveYtdlpRunner();
    return true;
  } catch {
    return false;
  }
}

function createUtilityDir() {
  const id = randomUUID();
  const jobDir = path.join(DOWNLOAD_DIR, id);
  fs.mkdirSync(jobDir, { recursive: true });
  return { id, jobDir };
}

function safeFileName(name: string) {
  const parsed = path.parse(path.basename(name || 'upload'));
  const base = parsed.name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'upload';
  return `${base}${parsed.ext.toLowerCase()}`;
}

function normalizeUploadName(name: string) {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

function outputName(inputPath: string, suffix: string, extension: string) {
  const parsed = path.parse(inputPath);
  return `${parsed.name}${suffix}.${extension.replace(/^\./, '')}`;
}

function fileToDownload(id: string, fullPath: string): JobFile {
  const fileName = path.basename(fullPath);
  return {
    fileName,
    title: path.parse(fileName).name,
    size: fs.statSync(fullPath).size,
    downloadUrl: `/downloads/${id}/${encodeURIComponent(fileName)}`
  };
}

interface UploadedFile {
  filePath: string;
  originalName: string;
}

const MAX_BATCH_FILES = 20;

function uniquePathInDir(jobDir: string, name: string): string {
  const parsed = path.parse(name);
  let candidate = path.join(jobDir, name);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    counter += 1;
    candidate = path.join(jobDir, `${parsed.name} (${counter})${parsed.ext}`);
  }
  return candidate;
}

export type ToolOptions = Record<string, string | number | boolean>;

function parseMultipartUpload(req: http.IncomingMessage, parseOpts: { validateTool?: boolean } = {}): Promise<{ tool: FileTool; files: UploadedFile[]; options: ToolOptions; jobDir: string; id: string }> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (!contentType?.includes('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data upload.'));
      return;
    }

    const { id, jobDir } = createUtilityDir();
    const busboy = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: MAX_BATCH_FILES, fileSize: MAX_UPLOAD_SIZE, fields: 32 } });
    let tool = '' as FileTool;
    const files: UploadedFile[] = [];
    let options: ToolOptions = {};
    let uploadError: Error | null = null;
    const writePromises: Promise<void>[] = [];

    busboy.on('field', (name, value) => {
      if (name === 'tool') {
        tool = value as FileTool;
      } else if (name === 'options') {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            options = parsed as ToolOptions;
          }
        } catch {
          // ignore malformed options blob
        }
      }
    });

    busboy.on('file', (_name, file, info) => {
      const originalName = safeFileName(normalizeUploadName(info.filename || 'upload'));
      const filePath = uniquePathInDir(jobDir, originalName);
      const finalName = path.basename(filePath);
      const writer = fs.createWriteStream(filePath);
      files.push({ filePath, originalName: finalName });
      writePromises.push(new Promise((resolveWrite, rejectWrite) => {
        writer.on('finish', resolveWrite);
        writer.on('error', rejectWrite);
      }));

      file.on('limit', () => {
        uploadError = new Error(`File "${originalName}" too large. Maximum 40 MB per file.`);
        file.unpipe(writer);
        writer.destroy();
      });

      file.pipe(writer);
    });

    busboy.on('filesLimit', () => {
      uploadError = new Error(`Too many files. Maximum ${MAX_BATCH_FILES} per batch.`);
    });

    busboy.on('error', reject);
    busboy.on('finish', async () => {
      if (uploadError) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        reject(uploadError);
        return;
      }

      try {
        await Promise.all(writePromises);
      } catch (error) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        reject(error);
        return;
      }

      if (parseOpts.validateTool !== false && (!tool || !isFileTool(tool))) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        reject(new Error('Unsupported file tool.'));
        return;
      }

      if (!files.length) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        reject(new Error('Upload must include at least one file.'));
        return;
      }

      if (parseOpts.validateTool !== false) {
        const allowed = fileToolExtensions[tool];
        const invalid = files.find((file) => !allowed.includes(path.extname(file.filePath).toLowerCase()));
        if (invalid) {
          fs.rmSync(jobDir, { recursive: true, force: true });
          const extension = path.extname(invalid.filePath).toLowerCase().replace('.', '') || 'unknown';
          reject(new Error(`File "${invalid.originalName}" (.${extension}) is not valid for this tool. Accepted: ${allowed.join(', ')}.`));
          return;
        }
      }

      resolve({ tool, files, options, jobDir, id });
    });

    req.pipe(busboy);
  });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function pickString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(String(value)) ? value as T : fallback;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: ZipEntry[]): Buffer {
  // Stored (uncompressed) ZIP — outputs are already compressed media types
  const localBlocks: Buffer[] = [];
  const centralBlocks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    localHeader.writeUInt16LE(0, 8); // method: store
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18); // compressed size
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localBlocks.push(localHeader, nameBuffer, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // method
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x21, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(0, 38); // external attributes
    centralHeader.writeUInt32LE(offset, 42);

    centralBlocks.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + entry.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const block of centralBlocks) centralSize += block.length;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4); // disk
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(centralStart, 16);
  endRecord.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localBlocks, ...centralBlocks, endRecord]);
}

function extractCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;

  if ('richText' in obj && Array.isArray(obj.richText)) {
    return obj.richText.map((part: unknown) => {
      const node = part as { text?: unknown } | null;
      return node && typeof node === 'object' && node.text != null ? String(node.text) : '';
    }).join('');
  }

  if ('hyperlink' in obj) {
    return obj.text !== undefined && obj.text !== null ? String(obj.text) : String(obj.hyperlink);
  }

  if ('formula' in obj || 'sharedFormula' in obj) {
    return obj.result !== undefined ? extractCellValue(obj.result) : null;
  }

  if ('error' in obj) {
    return `#ERR ${String(obj.error)}`;
  }

  if ('text' in obj) {
    return String(obj.text);
  }

  return value;
}

function jsonSafeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function extractWorksheet(worksheet: ExcelJS.Worksheet): { headers: string[]; rows: Record<string, unknown>[] } {
  type RowSnapshot = { num: number; cells: Map<number, unknown> };
  const allRows: RowSnapshot[] = [];
  let maxColumn = 0;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells = new Map<number, unknown>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.type === ExcelJS.ValueType.Merge) return;
      const value = extractCellValue(cell.value);
      if (value !== null && value !== '') {
        cells.set(colNumber, value);
        if (colNumber > maxColumn) maxColumn = colNumber;
      }
    });
    if (cells.size > 0) allRows.push({ num: rowNumber, cells });
  });

  if (!allRows.length || maxColumn === 0) {
    return { headers: [], rows: [] };
  }

  let headerIndex = 0;
  let bestScore = -1;
  const scanLimit = Math.min(20, allRows.length);
  for (let i = 0; i < scanLimit; i++) {
    const cells = allRows[i].cells;
    let stringCount = 0;
    for (const value of cells.values()) {
      if (typeof value === 'string') stringCount += 1;
    }
    const score = cells.size * 2 + stringCount;
    if (score > bestScore) {
      bestScore = score;
      headerIndex = i;
    }
  }

  const headerCells = allRows[headerIndex].cells;
  const rawHeaders: string[] = [];
  for (let c = 1; c <= maxColumn; c++) {
    const value = headerCells.get(c);
    const stringValue = value == null ? '' : String(value).trim();
    rawHeaders.push(stringValue || `Column ${c}`);
  }

  const seen = new Map<string, number>();
  const headers = rawHeaders.map((header) => {
    const count = seen.get(header) || 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header} (${count + 1})`;
  });

  const rows: Record<string, unknown>[] = [];
  for (let i = headerIndex + 1; i < allRows.length; i++) {
    const { cells } = allRows[i];
    const entry: Record<string, unknown> = {};
    let hasValue = false;
    for (let c = 1; c <= maxColumn; c++) {
      const raw = cells.get(c);
      const value = raw === undefined ? null : raw;
      if (value !== null && value !== '') hasValue = true;
      entry[headers[c - 1]] = value;
    }
    if (hasValue) rows.push(entry);
  }

  return { headers, rows };
}

function sanitizeXmlName(name: string, fallback: string): string {
  if (!name) return fallback;

  const normalized = name.normalize('NFC');
  const allowedAscii = /[A-Za-z0-9_.\-]/;
  const isLetterOrDigit = /[\p{L}\p{N}]/u;
  let cleaned = '';

  for (const ch of normalized) {
    if (allowedAscii.test(ch) || (ch.charCodeAt(0) > 127 && isLetterOrDigit.test(ch))) {
      cleaned += ch;
    } else {
      cleaned += '_';
    }
  }

  cleaned = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;

  const first = cleaned.charAt(0);
  if (first !== '_' && !/[A-Za-z]/.test(first) && !/\p{L}/u.test(first)) {
    cleaned = `_${cleaned}`;
  }

  return cleaned;
}

function buildSafeHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  headers.forEach((header, index) => {
    const fallback = `Field${index + 1}`;
    const base = sanitizeXmlName(header, fallback);
    let candidate = base;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${counter++}`;
    }
    used.add(candidate);
    map.set(header, candidate);
  });
  return map;
}

function cellTextForXml(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function excelToJson(inputPath: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  const sheets = workbook.worksheets.map((worksheet) => {
    const { headers, rows } = extractWorksheet(worksheet);
    return {
      name: worksheet.name,
      headers,
      rows: rows.map((row) => {
        const out: Record<string, unknown> = {};
        headers.forEach((header) => {
          out[header] = jsonSafeValue(row[header] ?? null);
        });
        return out;
      })
    };
  });

  fs.writeFileSync(outputPath, JSON.stringify({ sheets }, null, 2), 'utf8');
}

async function excelToXml(inputPath: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  const sheets = workbook.worksheets.map((worksheet) => {
    const { headers, rows } = extractWorksheet(worksheet);
    const safeMap = buildSafeHeaderMap(headers);

    return {
      '@_name': worksheet.name,
      row: rows.map((rowData) => {
        const rowObj: Record<string, unknown> = {};
        headers.forEach((header) => {
          const safeName = safeMap.get(header) || sanitizeXmlName(header, 'Field');
          rowObj[safeName] = {
            '@_name': header,
            '#text': cellTextForXml(rowData[header])
          };
        });
        return rowObj;
      })
    };
  });

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: false,
    processEntities: true,
    textNodeName: '#text'
  });

  const xmlBody = builder.build({ workbook: { sheet: sheets } });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody.trimStart()}`;
  fs.writeFileSync(outputPath, xml, 'utf8');
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

async function excelToCsv(inputPath: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel file does not contain any worksheet.');

  const { headers, rows } = extractWorksheet(worksheet);
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(outputPath, `﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

function normalizeRowsFromJson(data: unknown): Array<{ name: string; rows: Record<string, unknown>[] }> {
  if (Array.isArray(data)) {
    return [{ name: 'Sheet1', rows: data as Record<string, unknown>[] }];
  }

  if (data && typeof data === 'object' && Array.isArray((data as { sheets?: unknown }).sheets)) {
    return ((data as { sheets: Array<{ name?: string; rows?: unknown }> }).sheets).map((sheet, index) => ({
      name: sheet.name || `Sheet${index + 1}`,
      rows: Array.isArray(sheet.rows) ? sheet.rows as Record<string, unknown>[] : []
    }));
  }

  if (data && typeof data === 'object') {
    return [{ name: 'Sheet1', rows: [data as Record<string, unknown>] }];
  }

  throw new Error('JSON must be an object, an array, or { sheets: [{ name, rows }] }.');
}

async function rowsToExcel(sheets: Array<{ name: string; rows: Record<string, unknown>[] }>, outputPath: string) {
  const workbook = new ExcelJS.Workbook();

  sheets.forEach((sheet) => {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || 'Sheet');
    const headers = Array.from(new Set(sheet.rows.flatMap((row) => Object.keys(row))));
    worksheet.columns = headers.map((header) => ({ header, key: header, width: Math.min(Math.max(header.length + 6, 14), 44) }));
    worksheet.addRows(sheet.rows);
  });

  await workbook.xlsx.writeFile(outputPath);
}

async function jsonToExcel(inputPath: string, outputPath: string) {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as unknown;
  await rowsToExcel(normalizeRowsFromJson(data), outputPath);
}

function normalizeXmlCell(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object' || Array.isArray(value)) return value;

  const obj = value as Record<string, unknown>;
  if ('#text' in obj) return obj['#text'] ?? '';

  const keys = Object.keys(obj).filter((key) => !key.startsWith('@_'));
  if (keys.length === 0) return '';

  return value;
}

function normalizeXmlRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (key.startsWith('@_') || key === '#text') continue;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const cell = value as Record<string, unknown>;
      const originalName = typeof cell['@_name'] === 'string' && cell['@_name'].trim()
        ? String(cell['@_name'])
        : key;
      result[originalName] = normalizeXmlCell(cell);
    } else {
      result[key] = value ?? '';
    }
  }

  return result;
}

function findRowsInXml(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value) && value.every((item) => item && typeof item === 'object')) {
    return value as Record<string, unknown>[];
  }

  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      const rows = findRowsInXml(child);
      if (rows.length) return rows;
    }
  }

  return [];
}

async function xmlToExcel(inputPath: string, outputPath: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true
  });
  const parsed = parser.parse(fs.readFileSync(inputPath, 'utf8')) as unknown;
  const workbookNode = (parsed as { workbook?: { sheet?: unknown } }).workbook;

  if (workbookNode?.sheet) {
    const sheetArray = Array.isArray(workbookNode.sheet) ? workbookNode.sheet : [workbookNode.sheet];
    const sheets = sheetArray.map((sheet, index) => {
      const sheetObject = sheet as { '@_name'?: string; name?: string; row?: unknown };
      const rowSource = sheetObject.row;
      const rawRows = Array.isArray(rowSource)
        ? rowSource
        : rowSource
          ? [rowSource]
          : [];
      return {
        name: sheetObject['@_name'] || sheetObject.name || `Sheet${index + 1}`,
        rows: rawRows.map((row) => normalizeXmlRow(row))
      };
    });
    await rowsToExcel(sheets, outputPath);
    return;
  }

  const rows = findRowsInXml(parsed);
  const normalized = rows.length
    ? rows.map((row) => normalizeXmlRow(row))
    : [normalizeXmlRow(parsed)];
  await rowsToExcel([{ name: 'XML', rows: normalized }], outputPath);
}

async function csvToExcel(inputPath: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.csv.readFile(inputPath);
  await workbook.xlsx.writeFile(outputPath);
}

function cleanPdfText(text: string) {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function textToDocxParagraphs(text: string) {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim());

  return blocks.flatMap((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];

    return new Paragraph({
      spacing: { after: 180 },
      children: lines.flatMap((line, index) => [
        ...(index > 0 ? [new TextRun({ break: 1 })] : []),
        new TextRun({ text: line })
      ])
    });
  });
}

async function pdfToWord(inputPath: string, outputPath: string) {
  const parser = new PDFParse({
    data: new Uint8Array(fs.readFileSync(inputPath)),
    disableFontFace: true,
    useSystemFonts: true
  });

  try {
    const result = await parser.getText();
    const text = cleanPdfText(result.text || '');

    if (!text) {
      throw new Error('PDF này không có lớp text để trích xuất. Với file scan/ảnh, cần OCR trước rồi mới xuất Word.');
    }

    const document = new Document({
      creator: 'Convert URL Studio',
      title: path.parse(inputPath).name,
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 260 },
            children: [new TextRun(path.parse(inputPath).name)]
          }),
          ...textToDocxParagraphs(text)
        ]
      }]
    });

    fs.writeFileSync(outputPath, await Packer.toBuffer(document));
  } finally {
    await parser.destroy();
  }
}

async function pdfToWordLayout(inputPath: string, outputPath: string) {
  const parser = new PDFParse({
    data: new Uint8Array(fs.readFileSync(inputPath)),
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false
  });

  try {
    const screenshots = await parser.getScreenshot({
      desiredWidth: 1600,
      imageBuffer: true,
      imageDataUrl: false
    });

    if (!screenshots.pages.length) {
      throw new Error('PDF này không có trang nào để chuyển đổi.');
    }

    const sections = screenshots.pages.map((page, index) => {
      const landscape = page.width > page.height;
      const imageWidth = landscape ? 1123 : 794;
      const imageHeight = Math.round(imageWidth * (page.height / page.width));

      return {
        properties: {
          page: {
            size: {
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
              width: landscape ? 16838 : 11906,
              height: landscape ? 11906 : 16838
            },
            margin: {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              header: 0,
              footer: 0
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [
              new ImageRun({
                type: 'png',
                data: page.data,
                transformation: {
                  width: imageWidth,
                  height: imageHeight
                },
                altText: {
                  title: `${path.parse(inputPath).name} - page ${index + 1}`,
                  description: 'Rendered PDF page',
                  name: `pdf-page-${index + 1}`
                }
              }),
              ...(index < screenshots.pages.length - 1 ? [new PageBreak()] : [])
            ]
          })
        ]
      };
    });

    const document = new Document({
      creator: 'Convert URL Studio',
      title: path.parse(inputPath).name,
      sections
    });

    fs.writeFileSync(outputPath, await Packer.toBuffer(document));
  } finally {
    await parser.destroy();
  }
}

async function pdfToWordEditableLayout(inputPath: string, outputPath: string) {
  const ready = await hasCommand('pdf2docx', ['--help'], 12000);
  if (!ready) {
    throw new Error('PDF to editable Word needs pdf2docx. Install it with: python -m pip install pdf2docx');
  }

  await run('pdf2docx', [
    'convert',
    inputPath,
    outputPath
  ], { timeoutMs: 180000 });

  if (!fs.existsSync(outputPath)) {
    throw new Error('pdf2docx did not create an output DOCX file.');
  }
}

async function getPdfTextCharacterCount(inputPath: string) {
  const parser = new PDFParse({
    data: new Uint8Array(fs.readFileSync(inputPath)),
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false
  });

  try {
    const result = await parser.getText();
    const text = cleanPdfText(result.text || '');
    return text.replace(/\s+/g, '').length;
  } catch {
    return 0;
  } finally {
    await parser.destroy();
  }
}

async function getPdfScanProfile(inputPath: string) {
  const mod = await import('pdf-lib');
  const bytes = fs.readFileSync(inputPath);
  const pdf = await mod.PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const pageCount = pages.length;
  const imagePages = pages.filter((page) => {
    try {
      const node = page.node as unknown as {
        Resources?: () => {
          lookup?: (key: unknown) => { keys?: () => unknown[]; lookup?: (key: unknown) => unknown } | undefined;
        } | undefined;
      };
      const xObjects = node.Resources?.()?.lookup?.(mod.PDFName.of('XObject'));
      const keys = xObjects?.keys?.() || [];
      if (!keys.length) return false;
      return keys.some((key) => {
        const value = xObjects?.lookup?.(key);
        const obj = value as { dict?: { get?: (key: unknown) => unknown } };
        const subtype = obj.dict?.get?.(mod.PDFName.of('Subtype'));
        return String(subtype) === '/Image';
      });
    } catch {
      return false;
    }
  }).length;

  const rotations = pages.map((page) => page.getRotation().angle);
  return {
    pageCount,
    imagePages,
    imagePageRatio: pageCount ? imagePages / pageCount : 0,
    rotations
  };
}

async function findPythonForScanOcr() {
  const candidates = ['python', 'python3', 'py'];
  for (const candidate of candidates) {
    if (!(await hasCommand(candidate, ['--version'], 5000))) continue;
    if (await hasCommand(candidate, ['-c', 'import fitz, pytesseract, docx, PIL'], 8000)) {
      return candidate;
    }
  }
  return null;
}

// Count editable text characters in a DOCX (paragraphs + table cells) via python-docx.
// Used to detect image-only DOCX output from pdf2docx. Returns a high number if it
// can't check (no Python) so we don't force an unnecessary fallback.
async function docxTextLength(docxPath: string): Promise<number> {
  const py = await findPythonForScanOcr();
  if (!py) return Number.MAX_SAFE_INTEGER;
  try {
    const { stdout } = await run(py, ['-c',
      'import sys,docx;d=docx.Document(sys.argv[1]);'
      + 'n=sum(len(p.text.strip()) for p in d.paragraphs);'
      + 'n+=sum(len(c.text.strip()) for t in d.tables for r in t.rows for c in r.cells);'
      + 'print(n)', docxPath], { timeoutMs: 30000 });
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

async function findTesseractCommand() {
  const envCmd = String(process.env.TESSERACT_CMD || '').trim();
  const candidates = [
    envCmd,
    'tesseract',
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await hasCommand(candidate, ['--version'], 8000)) {
      return candidate;
    }
  }
  return null;
}

async function findOcrmypdfCommand() {
  const envCmd = String(process.env.OCRMYPDF_CMD || '').trim();
  const candidates = [envCmd, 'ocrmypdf'].filter(Boolean);
  for (const c of candidates) {
    if (await hasCommand(c, ['--version'], 8000)) return c;
  }
  // Python -m fallback
  for (const py of ['python', 'python3', 'py']) {
    if (!(await hasCommand(py, ['--version'], 5000))) continue;
    if (await hasCommand(py, ['-m', 'ocrmypdf', '--version'], 8000)) {
      return `${py} -m ocrmypdf`;
    }
  }
  return null;
}

/**
 * Premium scanned-PDF → Word pipeline: add OCR text layer via ocrmypdf
 * (Tesseract + Vietnamese), then pdf2docx — preserves tables, layout, columns.
 */
async function scanPdfToWordOcrmyPdf(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const ocrmypdfCmd = await findOcrmypdfCommand();
  if (!ocrmypdfCmd) {
    throw new Error('OCRMYPDF_FALLBACK');
  }
  const tesseractCmd = await findTesseractCommand();
  if (!tesseractCmd) {
    throw new Error('PDF scan cần Tesseract OCR. Cài Tesseract + gói ngôn ngữ vie+eng rồi thử lại.');
  }
  const pdf2docxReady = await hasCommand('pdf2docx', ['--help'], 12000);
  if (!pdf2docxReady) {
    throw new Error('Cần pdf2docx để xuất Word có table/format. Cài: pip install pdf2docx');
  }

  const lang = String(options.ocrLang || 'vie+eng').replace(/[^a-zA-Z+_-]/g, '') || 'vie+eng';
  const force = String(options.ocrForce ?? 'true') !== 'false';
  const deskew = String(options.ocrDeskew ?? 'true') !== 'false';
  const cleanFinalRequested = String(options.ocrClean ?? 'true') !== 'false';
  const unpaperReady = await hasCommand('unpaper', ['--version'], 5000);
  const cleanFinal = cleanFinalRequested && unpaperReady;
  if (cleanFinalRequested && !unpaperReady) {
    console.warn('[pdf-to-word] unpaper missing — skipping --clean-final (install: linux=apt, win=choco install unpaper)');
  }
  const jobDir = path.dirname(inputPath);
  const tempOcrPdf = path.join(jobDir, `ocr-${randomUUID().slice(0, 8)}.pdf`);

  const ocrArgs: string[] = [
    '--language', lang,
    '--output-type', 'pdf',
    '--optimize', '0',
    '--rotate-pages',
    '--quiet'
  ];
  if (force) ocrArgs.push('--force-ocr');
  else ocrArgs.push('--skip-text'); // skip pages already containing text
  if (deskew) ocrArgs.push('--deskew');
  if (cleanFinal) ocrArgs.push('--clean-final');

  // Resolve command (might be "python -m ocrmypdf" — split if needed)
  const [bin, ...prefix] = ocrmypdfCmd.split(' ');
  try {
    await run(bin, [...prefix, ...ocrArgs, inputPath, tempOcrPdf], {
      timeoutMs: 10 * 60 * 1000,
      env: { ...process.env, TESSERACT_CMD: tesseractCmd }
    });
    if (!fs.existsSync(tempOcrPdf)) {
      throw new Error('ocrmypdf không tạo được PDF có OCR text layer.');
    }
    await run('pdf2docx', ['convert', tempOcrPdf, outputPath], { timeoutMs: 5 * 60 * 1000 });
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 200) {
      throw new Error('pdf2docx không tạo được DOCX từ PDF đã OCR.');
    }
  } finally {
    try { fs.unlinkSync(tempOcrPdf); } catch { /* ignore */ }
  }
}

async function scanPdfToWordOcr(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const script = path.join(ROOT, 'scripts', 'scan_to_docx.py');
  if (!fs.existsSync(script)) {
    throw new Error('Thiếu scripts/scan_to_docx.py để OCR PDF scan sang Word.');
  }
  const tesseractCmd = await findTesseractCommand();
  if (!tesseractCmd) {
    throw new Error('PDF này là file scan/ảnh và cần Tesseract OCR để tạo Word có text chỉnh sửa được. Local hiện chưa có tesseract. Cài Tesseract OCR + gói vie/eng, rồi chạy lại server.');
  }
  const pythonCmd = await findPythonForScanOcr();
  if (!pythonCmd) {
    throw new Error('PDF scan cần Python OCR packages. Cài local: python -m pip install pymupdf pytesseract pillow python-docx');
  }

  const lang = String(options.ocrLang || 'vie').replace(/[^a-zA-Z+_-]/g, '') || 'vie';
  const dpi = clampInt(options.ocrDpi, 220, 120, 360);
  const psm = clampInt(options.ocrPsm, 4, 3, 11);
  const pageLabel = String(options.pageLabel ?? 'false') === 'true';
  const outputMode = pickString(options.ocrOutput, ['editable', 'visual'] as const, 'editable');

  await run(pythonCmd, [
    script,
    inputPath,
    outputPath,
    '--lang', lang,
    '--dpi', String(dpi),
    '--psm', String(psm),
    '--page-label', pageLabel ? '1' : '0',
    '--tesseract-cmd', tesseractCmd,
    '--output-mode', outputMode
  ], { timeoutMs: 10 * 60 * 1000 });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 200) {
    throw new Error('OCR không tạo được DOCX hợp lệ từ file scan.');
  }
}

async function pdfToWordSmart(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const mode = pickString(options.pdfMode, ['auto', 'editable', 'ocr'] as const, 'auto');
  const [textChars, scanProfile] = await Promise.all([
    getPdfTextCharacterCount(inputPath),
    getPdfScanProfile(inputPath)
  ]);
  const isImageOnlyPdf = scanProfile.pageCount > 0 && scanProfile.imagePageRatio >= 0.8;
  const isScanned = textChars < 80 || isImageOnlyPdf;

  // Helper: try ocrmypdf+pdf2docx (best when it keeps text/tables), but pdf2docx
  // often embeds an OCR'd image-only scan as a picture and drops the text layer —
  // producing a DOCX with NO editable text. So we verify the output actually has
  // text; if it's image-only (or ocrmypdf is unavailable/fails), fall back to the
  // line-based scan_to_docx.py which always yields editable text paragraphs.
  async function runOcrPipeline() {
    try {
      await scanPdfToWordOcrmyPdf(inputPath, outputPath, options);
      const textLen = await docxTextLength(outputPath);
      if (textLen >= 20) {
        console.warn(`[pdf-to-word] used ocrmypdf+pdf2docx (text preserved, ${textLen} chars)`);
        return;
      }
      console.warn(`[pdf-to-word] pdf2docx produced image-only DOCX (textLen=${textLen}) — falling back to line-based OCR for editable text`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.startsWith('OCRMYPDF_FALLBACK')) {
        console.warn('[pdf-to-word] ocrmypdf+pdf2docx failed, falling back:', msg.slice(0, 200));
      }
    }
    // Line-based tesseract OCR → editable text paragraphs (no tables, but selectable text).
    await scanPdfToWordOcr(inputPath, outputPath, options);
    console.warn('[pdf-to-word] used scan_to_docx.py (editable text)');
  }

  if (mode === 'ocr') {
    await runOcrPipeline();
    return;
  }

  if (isScanned) {
    console.warn(`[pdf-to-word] scanned/image PDF detected: textChars=${textChars}, imagePages=${scanProfile.imagePages}/${scanProfile.pageCount}, rotations=${scanProfile.rotations.join(',')}`);
    if (mode === 'editable') {
      throw new Error('PDF này là file scan/ảnh, không có text layer. Chọn chế độ Auto hoặc OCR để chạy pipeline OCR (cần cài Tesseract + ocrmypdf cho chất lượng tốt nhất).');
    }
    await runOcrPipeline();
    return;
  }

  await pdfToWordEditableLayout(inputPath, outputPath);
}

async function convertWithLibreOffice(inputPath: string, outputDir: string, targetFormat: 'pdf' | 'docx') {
  const ready = await hasCommand(SOFFICE, libreOfficeHealthArgs(), 12000);
  if (!ready) {
    throw new Error('LibreOffice is not installed in this environment. Docker/Render installs it automatically after the next deploy.');
  }

  const convertTarget = targetFormat === 'pdf' ? 'pdf:writer_pdf_Export' : targetFormat;
  const expectedPath = path.join(outputDir, outputName(inputPath, '', targetFormat));

  await run(SOFFICE, [
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    libreOfficeProfileArg(path.join(outputDir, '.libreoffice-profile')),
    '--convert-to',
    convertTarget,
    '--outdir',
    outputDir,
    inputPath
  ], {
    timeoutMs: 120000,
    env: {
      ...process.env,
      LANG: process.env.LANG || 'en_US.UTF-8',
      SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN || 'svp'
    }
  });

  if (!fs.existsSync(expectedPath)) {
    throw new Error(`LibreOffice did not create the expected ${targetFormat.toUpperCase()} file.`);
  }
}

function imagePipeline(inputPath: string) {
  return sharp(inputPath, { failOn: 'none' }).rotate();
}

async function convertImage(inputPath: string, outputPath: string, format: 'png' | 'jpeg' | 'webp' | 'avif', options: ToolOptions = {}) {
  const pipeline = imagePipeline(inputPath);

  if (format === 'png') {
    const compressionLevel = clampInt(options.compression, 9, 0, 9);
    await pipeline.png({ compressionLevel, palette: false }).toFile(outputPath);
    return;
  }

  if (format === 'jpeg') {
    const quality = clampInt(options.quality, 88, 30, 100);
    await pipeline.jpeg({ quality, mozjpeg: true }).toFile(outputPath);
    return;
  }

  if (format === 'webp') {
    const quality = clampInt(options.quality, 86, 30, 100);
    const effort = clampInt(options.effort, 5, 0, 6);
    await pipeline.webp({ quality, effort }).toFile(outputPath);
    return;
  }

  const quality = clampInt(options.quality, 62, 30, 90);
  const effort = clampInt(options.effort, 7, 0, 9);
  await pipeline.avif({ quality, effort }).toFile(outputPath);
}

async function compressImage(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const quality = clampInt(options.quality, 78, 50, 95);
  const maxDimension = clampInt(options.maxDimension, 2560, 600, 6000);
  await imagePipeline(inputPath)
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(outputPath);
}

async function resizeImage(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const targetSize = clampInt(options.width, 1920, 200, 6000);
  const quality = clampInt(options.quality, 84, 40, 100);
  await imagePipeline(inputPath)
    .resize({ width: targetSize, height: targetSize, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 5 })
    .toFile(outputPath);
}

async function upscaleLanczos(inputPath: string, outputPath: string, width: number, height: number, scale: number) {
  await imagePipeline(inputPath)
    .resize({
      width: Math.min(width * scale, 6000),
      height: Math.min(height * scale, 6000),
      fit: 'inside',
      kernel: sharp.kernel.lanczos3
    })
    .sharpen({ sigma: 1, m1: 1.1, m2: 1.6 })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

// AI super-resolution via OpenCV dnn_superres (learned EDSR/ESPCN/FSRCNN models).
// Falls back to lanczos when cv2 is unavailable, the image is too large for CPU SR,
// or the model run fails — so the tool always returns a result.
async function upscaleImage(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot read image dimensions.');

  const scaleLabel = pickString(options.scale, ['2x', '3x', '4x'] as const, '2x');
  const scale = scaleLabel === '4x' ? 4 : scaleLabel === '3x' ? 3 : 2;
  const model = pickString(options.srModel, ['espcn', 'fsrcnn', 'edsr'] as const, 'espcn');

  const pixels = metadata.width * metadata.height;
  // EDSR is heavy on CPU; cap it hard. ESPCN/FSRCNN are light and handle bigger inputs.
  const maxPixels = model === 'edsr' ? 800_000 : 3_000_000;
  const scanScript = path.join(ROOT, 'scripts', 'upscale.py');
  const pythonCmd = pixels <= maxPixels && fs.existsSync(scanScript) ? await findPythonWithCv2() : null;

  if (pythonCmd) {
    try {
      await run(pythonCmd, [
        scanScript, inputPath, outputPath,
        '--scale', String(scale),
        '--model', model,
        '--models-dir', path.join(ROOT, 'data', 'sr-models')
      ], { timeoutMs: 5 * 60 * 1000 });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200) return;
    } catch {
      /* fall through to lanczos */
    }
  }

  await upscaleLanczos(inputPath, outputPath, metadata.width, metadata.height, scale);
}

async function squareThumbnail(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const size = clampInt(options.size, 1200, 200, 2400);
  const background = typeof options.background === 'string' && /^#[0-9a-f]{6}$/i.test(options.background)
    ? options.background
    : '#ffffff';
  const quality = clampInt(options.quality, 86, 50, 100);
  await imagePipeline(inputPath)
    .resize({ width: size, height: size, fit: 'contain', background, withoutEnlargement: false })
    .webp({ quality, effort: 5 })
    .toFile(outputPath);
}

async function stripMetadata(inputPath: string, outputPath: string) {
  const extension = path.extname(outputPath).toLowerCase();
  const pipeline = imagePipeline(inputPath);

  if (extension === '.jpg' || extension === '.jpeg') {
    await pipeline.jpeg({ quality: 90, mozjpeg: true }).toFile(outputPath);
    return;
  }

  if (extension === '.webp') {
    await pipeline.webp({ quality: 88, effort: 5 }).toFile(outputPath);
    return;
  }

  if (extension === '.avif') {
    await pipeline.avif({ quality: 64, effort: 7 }).toFile(outputPath);
    return;
  }

  await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);
}

async function imageMetadata(inputPath: string, outputPath: string) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  const stats = fs.statSync(inputPath);
  const useful = {
    fileName: path.basename(inputPath),
    size: stats.size,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    space: metadata.space,
    channels: metadata.channels,
    depth: metadata.depth,
    density: metadata.density,
    hasAlpha: metadata.hasAlpha,
    orientation: metadata.orientation,
    pages: metadata.pages,
    chromaSubsampling: metadata.chromaSubsampling,
    compression: metadata.compression
  };
  fs.writeFileSync(outputPath, JSON.stringify(useful, null, 2), 'utf8');
}

async function imageToPdf(inputPath: string, outputPath: string) {
  const pngBytes = await imagePipeline(inputPath)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const metadata = await sharp(pngBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot read image dimensions.');

  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(pngBytes);
  const maxWidth = 595.28;
  const maxHeight = 841.89;
  const scale = Math.min(maxWidth / metadata.width, maxHeight / metadata.height, 1);
  const width = metadata.width * scale;
  const height = metadata.height * scale;
  const page = pdf.addPage([Math.max(width, 1), Math.max(height, 1)]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  fs.writeFileSync(outputPath, await pdf.save());
}

async function pdfToPng(inputPath: string, jobDir: string, options: ToolOptions = {}) {
  const parser = new PDFParse({
    data: new Uint8Array(fs.readFileSync(inputPath)),
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false
  });

  const desiredWidth = clampInt(options.width, 1800, 600, 3600);

  try {
    const screenshots = await parser.getScreenshot({
      desiredWidth,
      imageBuffer: true,
      imageDataUrl: false
    });

    if (!screenshots.pages.length) throw new Error('PDF does not contain any page.');

    const baseName = path.parse(inputPath).name;
    return screenshots.pages.map((page) => {
      const outputPath = path.join(jobDir, `${baseName}-page-${String(page.pageNumber).padStart(2, '0')}.png`);
      fs.writeFileSync(outputPath, page.data);
      return outputPath;
    });
  } finally {
    await parser.destroy();
  }
}

// Translate text via the free MyMemory API (no key). It caps each request at
// ~500 chars, so we split on sentence/line boundaries and join the results.
async function translateText(text: string, fromLang: string, toLang: string): Promise<string> {
  const chunks: string[] = [];
  let current = '';
  for (const piece of text.split(/(?<=[.!?。\n])\s+/)) {
    if ((current + ' ' + piece).trim().length > 480) {
      if (current.trim()) chunks.push(current.trim());
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const out: string[] = [];
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(fromLang)}|${encodeURIComponent(toLang)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = await res.json() as { responseData?: { translatedText?: string }; responseStatus?: number | string };
      const translated = data?.responseData?.translatedText;
      const status = Number(data?.responseStatus);
      out.push(translated && status === 200 ? translated : chunk);
    } catch {
      out.push(chunk); // keep source on failure so nothing is lost
    }
  }
  return out.join(' ');
}

// OCR an image with tesseract, then translate the extracted text. Produces a
// bilingual Markdown file (source + translation side by side).
async function ocrTranslate(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const tesseract = await findTesseractCommand();
  if (!tesseract) {
    throw new Error('OCR cần Tesseract. Cài: winget install UB-Mannheim.TesseractOCR (kèm gói tiếng Việt).');
  }
  const ocrLang = pickString(options.ocrLang, ['vie+eng', 'eng', 'vie'] as const, 'vie+eng');
  const targetLang = pickString(options.targetLang, ['vi', 'en'] as const, 'vi');
  const sourceLang = pickString(options.sourceLang, ['auto', 'en', 'vi'] as const, 'auto');

  const { stdout } = await run(tesseract, [inputPath, 'stdout', '-l', ocrLang], { timeoutMs: 120000 });
  const sourceText = stdout.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!sourceText) {
    throw new Error('Không nhận diện được chữ trong ảnh — thử ảnh rõ nét hơn hoặc đổi ngôn ngữ OCR.');
  }

  // MyMemory needs a concrete source lang; infer from OCR setting when "auto".
  const from = sourceLang !== 'auto' ? sourceLang : (targetLang === 'vi' ? 'en' : 'vi');
  const translated = await translateText(sourceText, from, targetLang);

  const langName: Record<string, string> = { vi: 'Tiếng Việt', en: 'English' };
  const md =
`# OCR & Dịch thuật

**Nguồn (${from === 'vi' ? 'Tiếng Việt' : 'English'}):**

${sourceText}

---

**Bản dịch (${langName[targetLang]}):**

${translated}
`;
  fs.writeFileSync(outputPath, md, 'utf8');
}

// Generate a caption / alt-text / product description for an image using an
// OpenAI vision model. Requires OPENAI_API_KEY; outputs a Markdown file.
async function captionImage(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Tạo mô tả ảnh cần OPENAI_API_KEY. Đặt biến môi trường rồi khởi động lại server (set OPENAI_API_KEY=sk-...).');
  }
  const mode = pickString(options.captionMode, ['alt', 'describe', 'product'] as const, 'describe');
  const lang = pickString(options.captionLang, ['vi', 'en'] as const, 'vi');
  const model = String(process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini');

  // Downscale to keep the request small and cheap; vision models don't need full res.
  const jpegBuffer = await sharp(inputPath, { failOn: 'none' })
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

  const langWord = lang === 'vi' ? 'tiếng Việt' : 'English';
  const prompts: Record<typeof mode, string> = {
    alt: `Viết alt-text SEO ngắn gọn (tối đa 125 ký tự) bằng ${langWord} mô tả ảnh này. Chỉ trả về alt-text, không giải thích.`,
    describe: `Mô tả chi tiết nội dung ảnh này bằng ${langWord}: chủ thể, bối cảnh, màu sắc, tâm trạng. Viết 2-4 câu tự nhiên.`,
    product: `Đây là ảnh sản phẩm e-commerce. Bằng ${langWord}, trả về Markdown gồm: tiêu đề sản phẩm, đoạn mô tả bán hàng 2-3 câu, và danh sách thuộc tính (màu sắc, chất liệu, kiểu dáng nếu nhận ra được).`
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompts[mode] },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API lỗi ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const caption = data?.choices?.[0]?.message?.content?.trim();
  if (!caption) {
    throw new Error('OpenAI không trả về nội dung mô tả.');
  }

  const titleByMode: Record<typeof mode, string> = {
    alt: 'Alt-text SEO', describe: 'Mô tả ảnh', product: 'Mô tả sản phẩm'
  };
  const md = `# ${titleByMode[mode]}\n\n_Ảnh: ${path.basename(inputPath)} · model: ${model}_\n\n${caption}\n`;
  fs.writeFileSync(outputPath, md, 'utf8');
}

// Python from the isolated .venv-tts (Coqui XTTS lives there so its pinned deps
// don't clash with the main ML stack). Returns null if the venv isn't set up.
function resolveTtsPython(): string | null {
  const candidates = [
    path.join(ROOT, '.venv-tts', 'Scripts', 'python.exe'),
    path.join(ROOT, '.venv-tts', 'bin', 'python')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Optional fine-tuned XTTS checkpoint dir (e.g. viXTTS for Vietnamese). Used when
// it contains config.json + model.pth; otherwise the default multilingual XTTS-v2 runs.
function resolveVixttsDir(): string | null {
  const dir = String(process.env.VIXTTS_DIR || '').trim() || path.join(ROOT, 'data', 'vixtts');
  return fs.existsSync(path.join(dir, 'config.json')) && fs.existsSync(path.join(dir, 'model.pth')) ? dir : null;
}

async function findPythonWithCv2(): Promise<string | null> {
  for (const candidate of ['python', 'python3', 'py']) {
    if (!(await hasCommand(candidate, ['--version']))) continue;
    if (await hasCommand(candidate, ['-c', 'import cv2'])) return candidate;
  }
  return null;
}

// CamScanner-style scan: opencv detects the document, perspective-warps it flat,
// deskews, then applies the chosen output mode. Falls back to a sharp threshold
// pipeline when no Python+cv2 is available so the tool always produces something.
async function scanDocument(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const mode = pickString(options.scanMode, ['color', 'gray', 'bw'] as const, 'bw');
  const autoCrop = String(options.autoCrop ?? 'true') !== 'false';
  const scanScript = path.join(ROOT, 'scripts', 'scan_document.py');
  const pythonCmd = fs.existsSync(scanScript) ? await findPythonWithCv2() : null;

  if (pythonCmd) {
    const args = [scanScript, inputPath, outputPath, '--mode', mode];
    if (!autoCrop) args.push('--no-crop');
    try {
      await run(pythonCmd, args, { timeoutMs: 120000 });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200) return;
    } catch {
      /* fall through to sharp fallback */
    }
  }

  // Fallback: no cv2 — basic enhance/threshold with sharp (no perspective correction).
  let pipeline = imagePipeline(inputPath)
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true });
  if (mode === 'color') {
    pipeline = pipeline.normalise().sharpen({ sigma: 1.0, m1: 1.2, m2: 1.8 });
  } else if (mode === 'gray') {
    pipeline = pipeline.grayscale().normalise().sharpen({ sigma: 1.1, m1: 1.3, m2: 2.0 });
  } else {
    pipeline = pipeline.grayscale().normalise().median(1)
      .sharpen({ sigma: 1.1, m1: 1.4, m2: 2.2 }).threshold(188);
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);
}

async function removeBackground(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const model = pickString(
    options.model,
    ['u2net', 'u2netp', 'silueta', 'isnet-general-use', 'isnet-anime'] as const,
    'u2net'
  );
  const ready = await hasCommand('rembg', ['--version'], 8000);
  if (!ready) {
    throw new Error('Xóa nền cần rembg. Cài bằng: python -m pip install "rembg[cpu]"');
  }
  await run('rembg', ['i', '-m', model, inputPath, outputPath], { timeoutMs: 180000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
    throw new Error('rembg không tạo được file PNG sạch nền.');
  }
}

/**
 * Object removal via OpenCV inpaint.
 * Mode 'auto': run rembg → use foreground alpha as mask (inpaints the subject, keeps background).
 * Mode 'manual': caller provides base64 PNG mask in options.maskDataUrl (white = inpaint).
 */
async function removeObject(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const inpaintScript = path.join(ROOT, 'scripts', 'inpaint.py');
  if (!fs.existsSync(inpaintScript)) {
    throw new Error('Thiếu scripts/inpaint.py — không tách được vật thể.');
  }

  // Find a Python interpreter that has cv2 installed (not just any Python)
  // On Windows there are often multiple Python installs — python3 might resolve to a different
  // version than python. We probe each candidate for cv2 to pick the right one.
  const pythonCandidates = ['python', 'python3', 'py'];
  let pythonCmd: string | null = null;
  for (const candidate of pythonCandidates) {
    if (!(await hasCommand(candidate, ['--version']))) continue;
    if (await hasCommand(candidate, ['-c', 'import cv2'])) {
      pythonCmd = candidate;
      break;
    }
  }
  if (!pythonCmd) {
    // Fallback: at least find a working Python (so the error is more helpful)
    for (const candidate of pythonCandidates) {
      if (await hasCommand(candidate, ['--version'])) {
        const pyVer = candidate;
        throw new Error(
          `Cần opencv-python (cv2) cho ${pyVer}. ` +
          `Cài bằng: ${pyVer} -m pip install opencv-python-headless`
        );
      }
    }
    throw new Error('Cần Python 3 + opencv-python để chạy inpaint. Cài Python và "pip install opencv-python-headless".');
  }

  const mode = pickString(options.mode, ['auto', 'manual'] as const, 'auto');
  const method = pickString(options.method, ['auto', 'ldm', 'lama', 'telea', 'ns'] as const, 'auto');
  const dilate = clampInt(options.dilate, 12, 0, 40);
  const feather = clampInt(options.feather, 3, 0, 40);
  const ldmSteps = clampInt(options.ldmSteps, 35, 10, 50);
  const removeShadow = String(options.removeShadow ?? 'true') !== 'false';
  const removeReflection = String(options.removeReflection ?? 'true') !== 'false';
  const premium = String(options.premium ?? 'true') !== 'false';
  const jobDir = path.dirname(inputPath);
  const maskPath = path.join(jobDir, `mask-${randomUUID().slice(0, 8)}.png`);

  // Build mask
  if (mode === 'auto') {
    // Run rembg to get foreground, then extract alpha as mask
    const ready = await hasCommand('rembg', ['--version'], 8000);
    if (!ready) {
      throw new Error('Auto-detect cần rembg. Cài bằng: pip install "rembg[cpu]" — hoặc dùng chế độ Manual brush.');
    }
    const model = pickString(
      options.detectModel,
      ['u2net', 'u2netp', 'silueta', 'isnet-general-use', 'isnet-anime'] as const,
      'u2net'
    );
    const rembgOut = path.join(jobDir, `rembg-${randomUUID().slice(0, 8)}.png`);
    await run('rembg', ['i', '-m', model, inputPath, rembgOut], { timeoutMs: 180000 });
    if (!fs.existsSync(rembgOut)) {
      throw new Error('rembg không tạo được file để extract mask.');
    }

    // Extract alpha channel as grayscale mask
    const { data, info } = await sharp(rembgOut)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const mask = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
      // Subject pixel = high alpha = inpaint here
      mask[i] = data[i * channels + 3];
    }
    await sharp(mask, { raw: { width, height, channels: 1 } })
      .png()
      .toFile(maskPath);
    try { fs.unlinkSync(rembgOut); } catch { /* ignore */ }
  } else {
    // Manual mode: maskDataUrl is base64 PNG
    const dataUrl = typeof options.maskDataUrl === 'string' ? options.maskDataUrl : '';
    const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
    if (!match) {
      throw new Error('Thiếu maskDataUrl (base64 PNG) cho chế độ Manual brush.');
    }
    const maskBuffer = Buffer.from(match[1], 'base64');
    if (maskBuffer.length < 200) {
      throw new Error('Mask quá nhỏ — chưa vẽ vùng nào cần xoá?');
    }
    // Convert to grayscale and resize to match input
    const inputMeta = await sharp(inputPath).metadata();
    await sharp(maskBuffer)
      .resize(inputMeta.width, inputMeta.height, { fit: 'fill' })
      .grayscale()
      .png()
      .toFile(maskPath);
  }

  // Run inpaint — LDM 30-90s, LaMa 10-15s on CPU. First run also downloads model.
  try {
    await run(pythonCmd, [
      inpaintScript,
      inputPath,
      maskPath,
      outputPath,
      '--method', method,
      '--dilate', String(dilate),
      '--feather', String(feather),
      '--ldm-steps', String(ldmSteps),
      '--remove-shadow', removeShadow ? '1' : '0',
      '--remove-reflection', removeReflection ? '1' : '0',
      '--premium', premium ? '1' : '0'
    ], { timeoutMs: 8 * 60 * 1000 });
  } finally {
    try { fs.unlinkSync(maskPath); } catch { /* ignore */ }
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 200) {
    throw new Error('Inpaint xuất file rỗng — vật thể có thể quá lớn so với ảnh.');
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const num = parseInt(match[1], 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function detectCornerColor(data: Buffer, width: number, height: number): { r: number; g: number; b: number } {
  // Average 4 corners (10x10 sample each)
  const samples = [
    [0, 0], [width - 10, 0], [0, height - 10], [width - 10, height - 10]
  ];
  let r = 0, g = 0, b = 0, n = 0;
  for (const [sx, sy] of samples) {
    for (let dy = 0; dy < 10; dy++) {
      for (let dx = 0; dx < 10; dx++) {
        const x = Math.min(width - 1, sx + dx);
        const y = Math.min(height - 1, sy + dy);
        const idx = (y * width + x) * 4;
        r += data[idx];
        g += data[idx + 1];
        b += data[idx + 2];
        n += 1;
      }
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

async function chromaKey(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const targetMode = pickString(options.target, ['auto', 'custom'] as const, 'auto');
  const tolerance = clampInt(options.tolerance, 32, 0, 200);
  const feather = clampInt(options.feather, 12, 0, 80);

  const image = sharp(inputPath, { failOn: 'none' }).rotate().ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error('Chroma key cần ảnh RGBA — thử lại với file ảnh chuẩn.');
  }

  const target = targetMode === 'custom'
    ? hexToRgb(typeof options.color === 'string' ? options.color : '#000000')
    : detectCornerColor(data, info.width, info.height);
  if (!target) throw new Error('Mã màu HEX không hợp lệ (vd: #000000).');

  const featherEnd = tolerance + feather;
  const denom = Math.max(1, featherEnd - tolerance);
  const pixels = info.width * info.height;
  const buf = Buffer.from(data);

  for (let i = 0; i < pixels; i++) {
    const idx = i * 4;
    const dr = buf[idx] - target.r;
    const dg = buf[idx + 1] - target.g;
    const db = buf[idx + 2] - target.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist <= tolerance) {
      buf[idx + 3] = 0;
    } else if (dist < featherEnd) {
      const t = (dist - tolerance) / denom;
      buf[idx + 3] = Math.round(buf[idx + 3] * t);
    }
  }

  await sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function cropImage(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot read image dimensions.');

  const aspectPreset = pickString(
    options.aspect,
    ['custom', 'square', '4:3', '3:2', '16:9', '9:16', '3:4', '2:3'] as const,
    'custom'
  );

  let cropWidth = metadata.width;
  let cropHeight = metadata.height;

  if (aspectPreset !== 'custom') {
    const [w, h] = aspectPreset === 'square' ? [1, 1] : aspectPreset.split(':').map(Number);
    const targetRatio = w / h;
    const imageRatio = metadata.width / metadata.height;
    if (imageRatio > targetRatio) {
      cropHeight = metadata.height;
      cropWidth = Math.round(metadata.height * targetRatio);
    } else {
      cropWidth = metadata.width;
      cropHeight = Math.round(metadata.width / targetRatio);
    }
  } else {
    cropWidth = clampInt(options.width, metadata.width, 1, metadata.width);
    cropHeight = clampInt(options.height, metadata.height, 1, metadata.height);
  }

  const x = clampInt(options.x, Math.round((metadata.width - cropWidth) / 2), 0, metadata.width - cropWidth);
  const y = clampInt(options.y, Math.round((metadata.height - cropHeight) / 2), 0, metadata.height - cropHeight);

  await imagePipeline(inputPath)
    .extract({ left: x, top: y, width: cropWidth, height: cropHeight })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function rotateImage(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const rotateDegrees = clampInt(options.rotate, 0, -360, 360);
  const flipH = String(options.flipH) === 'true';
  const flipV = String(options.flipV) === 'true';
  const background = typeof options.background === 'string' && /^#[0-9a-f]{6}$/i.test(options.background)
    ? options.background
    : '#ffffff';

  let pipeline = imagePipeline(inputPath);
  if (rotateDegrees !== 0) {
    pipeline = pipeline.rotate(rotateDegrees, { background });
  }
  if (flipH) pipeline = pipeline.flop();
  if (flipV) pipeline = pipeline.flip();
  await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);
}

async function filterImage(inputPath: string, outputPath: string, options: ToolOptions = {}) {
  const mode = pickString(
    options.filter,
    ['grayscale', 'sepia', 'invert', 'blur', 'sharpen', 'brightness', 'cool', 'warm'] as const,
    'grayscale'
  );
  const intensity = clampFloat(options.intensity, 1.0, 0.1, 3.0);

  let pipeline = imagePipeline(inputPath);
  switch (mode) {
    case 'grayscale':
      pipeline = pipeline.grayscale();
      break;
    case 'sepia':
      pipeline = pipeline.recomb([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131]
      ]);
      break;
    case 'invert':
      pipeline = pipeline.negate({ alpha: false });
      break;
    case 'blur':
      pipeline = pipeline.blur(Math.max(0.3, intensity * 5));
      break;
    case 'sharpen':
      pipeline = pipeline.sharpen({ sigma: 1.0 * intensity, m1: 1.0, m2: 2.0 });
      break;
    case 'brightness':
      pipeline = pipeline.modulate({ brightness: intensity });
      break;
    case 'cool':
      pipeline = pipeline.modulate({ saturation: 1.2 }).tint('#88aaff');
      break;
    case 'warm':
      pipeline = pipeline.modulate({ saturation: 1.2 }).tint('#ffaa66');
      break;
  }
  await pipeline.jpeg({ quality: 92, mozjpeg: true }).toFile(outputPath);
}

async function mergePdf(inputPaths: string[], outputPath: string) {
  if (!inputPaths.length) throw new Error('Cần ít nhất 1 file PDF.');
  const merged = await PDFDocument.create();
  for (const inputPath of inputPaths) {
    const bytes = fs.readFileSync(inputPath);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = doc.getPageIndices();
    const pages = await merged.copyPages(doc, indices);
    for (const page of pages) merged.addPage(page);
  }
  if (merged.getPageCount() === 0) throw new Error('PDF gộp ra rỗng — kiểm tra lại input.');
  fs.writeFileSync(outputPath, await merged.save());
}

function parsePageRanges(spec: string, totalPages: number): number[][] {
  const ranges: number[][] = [];
  const trimmed = (spec || '').trim();
  if (!trimmed || trimmed === 'all') {
    return Array.from({ length: totalPages }, (_, i) => [i]);
  }
  for (const part of trimmed.split(',').map((p) => p.trim()).filter(Boolean)) {
    const matchRange = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (matchRange) {
      const start = Math.max(1, parseInt(matchRange[1], 10));
      const end = Math.min(totalPages, parseInt(matchRange[2], 10));
      if (start <= end) {
        const indices: number[] = [];
        for (let i = start; i <= end; i++) indices.push(i - 1);
        ranges.push(indices);
      }
      continue;
    }
    const single = parseInt(part, 10);
    if (Number.isFinite(single) && single >= 1 && single <= totalPages) {
      ranges.push([single - 1]);
    }
  }
  return ranges.length ? ranges : Array.from({ length: totalPages }, (_, i) => [i]);
}

async function splitPdf(inputPath: string, jobDir: string, options: ToolOptions = {}) {
  const bytes = fs.readFileSync(inputPath);
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = source.getPageCount();
  if (totalPages === 0) throw new Error('PDF không có trang nào.');

  const mode = pickString(options.mode, ['pages', 'ranges'] as const, 'pages');
  const baseName = path.parse(inputPath).name;
  const outputs: string[] = [];

  if (mode === 'pages') {
    for (let i = 0; i < totalPages; i++) {
      const target = await PDFDocument.create();
      const [page] = await target.copyPages(source, [i]);
      target.addPage(page);
      const outputPath = path.join(jobDir, `${baseName}-page-${String(i + 1).padStart(2, '0')}.pdf`);
      fs.writeFileSync(outputPath, await target.save());
      outputs.push(outputPath);
    }
  } else {
    const ranges = parsePageRanges(String(options.ranges || ''), totalPages);
    for (let i = 0; i < ranges.length; i++) {
      const indices = ranges[i];
      const target = await PDFDocument.create();
      const pages = await target.copyPages(source, indices);
      for (const page of pages) target.addPage(page);
      const label = indices.length === 1
        ? `page-${String(indices[0] + 1).padStart(2, '0')}`
        : `pages-${indices[0] + 1}-${indices[indices.length - 1] + 1}`;
      const outputPath = path.join(jobDir, `${baseName}-${label}.pdf`);
      fs.writeFileSync(outputPath, await target.save());
      outputs.push(outputPath);
    }
  }
  return outputs;
}

const PREVIEW_ROW_LIMIT = 200;
const PREVIEW_TEXT_LIMIT = 200_000;

function previewCellString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function buildPreview(filePath: string): Promise<unknown> {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheets = workbook.worksheets.map((worksheet) => {
      const { headers, rows } = extractWorksheet(worksheet);
      return {
        name: worksheet.name,
        headers,
        totalRows: rows.length,
        rows: rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => headers.map((header) => previewCellString(row[header])))
      };
    });
    return { kind: 'workbook', sheets };
  }

  if (extension === '.csv') {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    if (!lines.length) return { kind: 'workbook', sheets: [{ name: 'CSV', headers: [], totalRows: 0, rows: [] }] };
    const parseLine = (line: string): string[] => {
      const cells: string[] = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line.charAt(i);
        if (quoted) {
          if (ch === '"' && line.charAt(i + 1) === '"') { cell += '"'; i++; }
          else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { cells.push(cell); cell = ''; }
        else cell += ch;
      }
      cells.push(cell);
      return cells;
    };
    const allRows = lines.map(parseLine);
    const [headerRow, ...bodyRows] = allRows;
    return {
      kind: 'workbook',
      sheets: [{
        name: path.basename(filePath, extension),
        headers: headerRow,
        totalRows: bodyRows.length,
        rows: bodyRows.slice(0, PREVIEW_ROW_LIMIT)
      }]
    };
  }

  if (extension === '.json') {
    const text = fs.readFileSync(filePath, 'utf8');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { kind: 'text', text: text.slice(0, PREVIEW_TEXT_LIMIT) };
    }
    if (data && typeof data === 'object' && Array.isArray((data as { sheets?: unknown }).sheets)) {
      const sheets = (data as { sheets: Array<{ name?: string; headers?: string[]; rows?: Record<string, unknown>[] }> }).sheets.map((sheet, index) => {
        const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
        const headers = sheet.headers && sheet.headers.length
          ? sheet.headers
          : Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
        return {
          name: sheet.name || `Sheet${index + 1}`,
          headers,
          totalRows: rows.length,
          rows: rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => headers.map((header) => previewCellString(row?.[header])))
        };
      });
      return { kind: 'workbook', sheets };
    }
    if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
      const headers = Array.from(new Set((data as Record<string, unknown>[]).flatMap((row) => Object.keys(row || {}))));
      return {
        kind: 'workbook',
        sheets: [{
          name: 'JSON',
          headers,
          totalRows: data.length,
          rows: (data as Record<string, unknown>[]).slice(0, PREVIEW_ROW_LIMIT).map((row) => headers.map((header) => previewCellString(row?.[header])))
        }]
      };
    }
    return { kind: 'text', text: JSON.stringify(data, null, 2).slice(0, PREVIEW_TEXT_LIMIT) };
  }

  const text = fs.readFileSync(filePath, 'utf8').slice(0, PREVIEW_TEXT_LIMIT);
  return { kind: 'text', text };
}

async function processFileConversion(tool: FileTool, inputPath: string, jobDir: string, options: ToolOptions = {}) {
  const out = (suffix: string, extension: string) => path.join(jobDir, outputName(inputPath, suffix, extension));
  const safeOut = (suffix: string, extension: string) => {
    const outputPath = out(suffix, extension);
    return path.resolve(outputPath) === path.resolve(inputPath)
      ? out(suffix || '-converted', extension)
      : outputPath;
  };

  switch (tool) {
    case 'excel-to-json': {
      const outputPath = out('', 'json');
      await excelToJson(inputPath, outputPath);
      return outputPath;
    }
    case 'json-to-excel': {
      const outputPath = out('', 'xlsx');
      await jsonToExcel(inputPath, outputPath);
      return outputPath;
    }
    case 'excel-to-xml': {
      const outputPath = out('', 'xml');
      await excelToXml(inputPath, outputPath);
      return outputPath;
    }
    case 'xml-to-excel': {
      const outputPath = out('', 'xlsx');
      await xmlToExcel(inputPath, outputPath);
      return outputPath;
    }
    case 'excel-to-csv': {
      const outputPath = out('', 'csv');
      await excelToCsv(inputPath, outputPath);
      return outputPath;
    }
    case 'csv-to-excel': {
      const outputPath = out('', 'xlsx');
      await csvToExcel(inputPath, outputPath);
      return outputPath;
    }
    case 'word-to-pdf': {
      await convertWithLibreOffice(inputPath, jobDir, 'pdf');
      return out('', 'pdf');
    }
    case 'pdf-to-word': {
      const outputPath = out('', 'docx');
      await pdfToWordSmart(inputPath, outputPath, options);
      return outputPath;
    }
    case 'image-to-png': {
      const outputPath = safeOut('', 'png');
      await convertImage(inputPath, outputPath, 'png', options);
      return outputPath;
    }
    case 'image-to-jpeg': {
      const outputPath = safeOut('', 'jpg');
      await convertImage(inputPath, outputPath, 'jpeg', options);
      return outputPath;
    }
    case 'image-to-webp': {
      const outputPath = safeOut('', 'webp');
      await convertImage(inputPath, outputPath, 'webp', options);
      return outputPath;
    }
    case 'image-to-avif': {
      const outputPath = safeOut('', 'avif');
      await convertImage(inputPath, outputPath, 'avif', options);
      return outputPath;
    }
    case 'image-to-pdf': {
      const outputPath = out('', 'pdf');
      await imageToPdf(inputPath, outputPath);
      return outputPath;
    }
    case 'pdf-to-png': {
      return pdfToPng(inputPath, jobDir, options);
    }
    case 'compress-image': {
      const outputPath = out('-compressed', 'jpg');
      await compressImage(inputPath, outputPath, options);
      return outputPath;
    }
    case 'resize-image': {
      const width = clampInt(options.width, 1920, 200, 6000);
      const outputPath = out(`-${width}`, 'webp');
      await resizeImage(inputPath, outputPath, options);
      return outputPath;
    }
    case 'upscale-image': {
      const scaleLabel = pickString(options.scale, ['2x', '3x', '4x'] as const, '2x');
      const outputPath = out(`-${scaleLabel}`, 'png');
      await upscaleImage(inputPath, outputPath, options);
      return outputPath;
    }
    case 'square-thumbnail': {
      const outputPath = out('-square', 'webp');
      await squareThumbnail(inputPath, outputPath, options);
      return outputPath;
    }
    case 'strip-metadata': {
      const extension = path.extname(inputPath).toLowerCase().replace('.', '') || 'png';
      const outputPath = out('-clean', extension === 'jpeg' ? 'jpg' : extension);
      await stripMetadata(inputPath, outputPath);
      return outputPath;
    }
    case 'image-metadata': {
      const outputPath = out('-metadata', 'json');
      await imageMetadata(inputPath, outputPath);
      return outputPath;
    }
    case 'scan-document': {
      const outputPath = out('-scan', 'png');
      await scanDocument(inputPath, outputPath, options);
      return outputPath;
    }
    case 'ocr-translate': {
      const outputPath = out('-ocr-translate', 'md');
      await ocrTranslate(inputPath, outputPath, options);
      return outputPath;
    }
    case 'caption-image': {
      const outputPath = out('-caption', 'md');
      await captionImage(inputPath, outputPath, options);
      return outputPath;
    }
    case 'remove-background': {
      const outputPath = safeOut('-nobg', 'png');
      await removeBackground(inputPath, outputPath, options);
      return outputPath;
    }
    case 'remove-object': {
      const outputPath = safeOut('-clean', 'png');
      await removeObject(inputPath, outputPath, options);
      return outputPath;
    }
    case 'chroma-key': {
      const outputPath = safeOut('-keyed', 'png');
      await chromaKey(inputPath, outputPath, options);
      return outputPath;
    }
    case 'crop-image': {
      const aspect = pickString(
        options.aspect,
        ['custom', 'square', '4:3', '3:2', '16:9', '9:16', '3:4', '2:3'] as const,
        'custom'
      );
      const suffix = aspect === 'custom' ? '-crop' : `-${aspect.replace(':', 'x')}`;
      const outputPath = safeOut(suffix, 'png');
      await cropImage(inputPath, outputPath, options);
      return outputPath;
    }
    case 'rotate-image': {
      const deg = clampInt(options.rotate, 0, -360, 360);
      const suffix = deg !== 0 ? `-r${deg}` : (options.flipH || options.flipV ? '-flip' : '-rotated');
      const outputPath = safeOut(suffix, 'png');
      await rotateImage(inputPath, outputPath, options);
      return outputPath;
    }
    case 'filter-image': {
      const filter = pickString(
        options.filter,
        ['grayscale', 'sepia', 'invert', 'blur', 'sharpen', 'brightness', 'cool', 'warm'] as const,
        'grayscale'
      );
      const outputPath = safeOut(`-${filter}`, 'jpg');
      await filterImage(inputPath, outputPath, options);
      return outputPath;
    }
    case 'split-pdf': {
      return splitPdf(inputPath, jobDir, options);
    }
    case 'merge-pdf': {
      // Handled at batch level; single-file run merges just one file
      const outputPath = out('-merged', 'pdf');
      await mergePdf([inputPath], outputPath);
      return outputPath;
    }
    default:
      throw new Error('Unsupported conversion tool.');
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

function getClientIp(req: http.IncomingMessage) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function assertMediaJobQuota(clientIp: string) {
  const now = Date.now();
  const bucket = (mediaRateBuckets.get(clientIp) || []).filter((createdAt) => now - createdAt < PUBLIC_RATE_WINDOW_MS);
  const activeJobs = Array.from(jobs.values()).filter((job) => {
    return job.clientIp === clientIp && (job.status === 'queued' || job.status === 'running');
  }).length;

  if (activeJobs >= PUBLIC_MAX_ACTIVE_JOBS) {
    throw new Error(`Bạn đang có ${activeJobs} job đang xử lý. Vui lòng chờ job hiện tại hoàn tất rồi thử lại.`);
  }

  if (bucket.length >= PUBLIC_RATE_MAX_JOBS) {
    const resetMinutes = Math.max(1, Math.ceil((PUBLIC_RATE_WINDOW_MS - (now - bucket[0])) / 60000));
    throw new Error(`Bạn đã dùng hết ${PUBLIC_RATE_MAX_JOBS} lượt chuyển đổi trong khung giờ hiện tại. Thử lại sau khoảng ${resetMinutes} phút.`);
  }

  bucket.push(now);
  mediaRateBuckets.set(clientIp, bucket);
}

function createJob(options: JobOptions, clientIp = 'unknown'): ConvertJob {
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
    jobDir,
    clientIp
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

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html: string, keys: string[]) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return stripHtml(match[1]);
    }
  }
  return '';
}

function extractTitle(html: string) {
  return extractMeta(html, ['og:title', 'twitter:title'])
    || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
}

function extractParagraphs(html: string) {
  const articleBlocks = html.match(/<article[\s\S]*?<\/article>/gi) || [html];
  const source = articleBlocks.join('\n');
  const matches = [...source.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const seen = new Set<string>();
  return matches
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length >= 55 && text.length <= 900)
    .filter((text) => {
      const key = text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return !/(cookie|copyright|đăng nhập|newsletter|subscribe|quảng cáo)/i.test(text);
    })
    .slice(0, 18);
}

function absoluteUrl(value: string, base: string) {
  if (!value) return '';
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ConvertURLStudio/1.0; +https://convert-url-api.onrender.com)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`Không lấy được bài viết. HTTP ${response.status}`);
  const text = await response.text();
  return text.slice(0, 2_500_000);
}

async function fetchArticle(url: string): Promise<NewsArticle> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Chỉ hỗ trợ URL http/https.');
  }

  const html = await fetchText(url);
  const imageUrl = absoluteUrl(extractMeta(html, ['og:image', 'twitter:image']), url);
  const title = extractTitle(html);
  const description = extractMeta(html, ['og:description', 'description', 'twitter:description']);
  const paragraphs = extractParagraphs(html);

  if (!title || paragraphs.length < 2) {
    throw new Error('Không trích xuất đủ nội dung bài viết. Hãy thử URL bài báo chi tiết khác.');
  }

  return {
    url,
    host: parsed.hostname.replace(/^www\./, ''),
    title,
    description,
    siteName: extractMeta(html, ['og:site_name', 'application-name']) || parsed.hostname.replace(/^www\./, ''),
    author: extractMeta(html, ['author', 'article:author']),
    publishedAt: extractMeta(html, ['article:published_time', 'pubdate', 'date', 'datePublished']),
    imageUrl,
    paragraphs
  };
}

function sentenceScore(sentence: string) {
  let score = Math.min(sentence.length, 240);
  if (/\d|%|tỷ|triệu|ngày|tháng|năm|USD|VND/i.test(sentence)) score += 40;
  if (/cho biết|theo|dự kiến|nguyên nhân|ảnh hưởng|kết quả|công bố/i.test(sentence)) score += 25;
  return score;
}

function pickKeyPoints(article: NewsArticle) {
  const sentences = article.paragraphs
    .join(' ')
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 45 && item.length <= 260);

  const picked = sentences
    .map((text) => ({ text, score: sentenceScore(text) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.text)
    .filter((text, index, all) => all.findIndex((other) => other.slice(0, 60) === text.slice(0, 60)) === index)
    .slice(0, 5);

  return picked.length ? picked : article.paragraphs.slice(0, 5);
}

function buildNewsStoryboard(article: NewsArticle, request: NewsVideoRequest) {
  const keyPoints = pickKeyPoints(article);
  const sourceLine = `${article.siteName || article.host}${article.publishedAt ? ` · ${new Date(article.publishedAt).toLocaleDateString('vi-VN')}` : ''}`;
  const toneLead = request.tone === 'social'
    ? 'Điểm đáng chú ý nhất hôm nay'
    : request.tone === 'executive'
      ? 'Tóm tắt điều hành'
      : 'Tin chính cần biết';

  const slides: StorySlide[] = [
    {
      label: 'HOOK',
      headline: article.title,
      body: [article.description || toneLead]
    },
    {
      label: 'SOURCE',
      headline: toneLead,
      body: [sourceLine, article.author ? `Tác giả/nguồn: ${article.author}` : `Nguồn: ${article.host}`]
    },
    {
      label: 'KEY POINTS',
      headline: 'Các ý chính',
      body: keyPoints.slice(0, 3)
    },
    {
      label: 'CONTEXT',
      headline: 'Bối cảnh',
      body: keyPoints.slice(3, 5).length ? keyPoints.slice(3, 5) : article.paragraphs.slice(1, 3)
    },
    {
      label: 'APPROVAL',
      headline: 'Bản nháp chờ duyệt',
      body: [
        'Kiểm tra lại nguồn, hình ảnh và nội dung trước khi đăng.',
        `Link gốc: ${article.url}`
      ]
    }
  ];

  const voiceover = slides
    .map((slide) => `${slide.headline}. ${slide.body.join(' ')}`)
    .join('\n\n');

  return { slides, keyPoints, voiceover, sourceLine };
}

function wrapText(text: string, maxChars: number, maxLines: number) {
  const words = stripHtml(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[,.!?;:]*$/, '')}...`;
  }
  return lines;
}

function svgEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgMultiline(lines: string[], x: number, y: number, size: number, weight = 700, fill = '#ffffff', lineHeight = 1.2) {
  const tspans = lines.map((line, index) =>
    `<tspan x="${x}" dy="${index === 0 ? 0 : size * lineHeight}">${svgEscape(line)}</tspan>`
  ).join('');
  return `<text x="${x}" y="${y}" font-family="Arial, 'Noto Sans', sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
}

async function downloadImageBuffer(url: string) {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ConvertURLStudio/1.0)' },
      signal: AbortSignal.timeout(18000)
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).subarray(0, 8_000_000);
  } catch {
    return null;
  }
}

async function createNewsSlide(slide: StorySlide, article: NewsArticle, outputPath: string, index: number, total: number, format: NewsVideoRequest['format'], imageBuffer: Buffer | null) {
  const portrait = format === 'short';
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  const margin = portrait ? 86 : 110;
  const titleSize = portrait ? 62 : 70;
  const bodySize = portrait ? 35 : 38;
  const maxTitleChars = portrait ? 22 : 42;
  const maxBodyChars = portrait ? 34 : 58;

  const base = imageBuffer
    ? await sharp(imageBuffer, { failOn: 'none' })
      .resize(width, height, { fit: 'cover' })
      .blur(12)
      .modulate({ brightness: 0.55, saturation: 0.82 })
      .png()
      .toBuffer()
    : await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: index % 2 ? '#102a43' : '#123b3a'
      }
    }).png().toBuffer();

  const titleLines = wrapText(slide.headline, maxTitleChars, portrait ? 5 : 3);
  const bodyLines = slide.body.flatMap((item) => wrapText(item, maxBodyChars, 2)).slice(0, portrait ? 8 : 6);
  const source = `${article.siteName || article.host} · ${index + 1}/${total}`;

  const overlay = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="rgba(0,0,0,0.32)"/>
      <rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}" rx="28" fill="rgba(15,23,42,0.58)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
      <text x="${margin + 34}" y="${margin + 66}" font-family="Arial, 'Noto Sans', sans-serif" font-size="${portrait ? 28 : 30}" font-weight="800" fill="#5eead4" letter-spacing="0">${svgEscape(slide.label)}</text>
      ${svgMultiline(titleLines, margin + 34, margin + (portrait ? 176 : 170), titleSize, 900, '#ffffff', 1.12)}
      ${svgMultiline(bodyLines.map((line) => `• ${line}`), margin + 38, height - margin - (portrait ? 470 : 330), bodySize, 650, '#dbeafe', 1.28)}
      <text x="${margin + 34}" y="${height - margin - 42}" font-family="Arial, 'Noto Sans', sans-serif" font-size="${portrait ? 25 : 28}" font-weight="700" fill="#cbd5e1">${svgEscape(source)}</text>
      <text x="${width - margin - 34}" y="${height - margin - 42}" text-anchor="end" font-family="Arial, 'Noto Sans', sans-serif" font-size="${portrait ? 23 : 25}" font-weight="700" fill="#fbbf24">DRAFT · REVIEW REQUIRED</text>
    </svg>
  `;

  await sharp(base)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);
}

function concatFileLine(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
  return `file '${normalized}'`;
}

async function renderNewsVideo(slidePaths: string[], outputPath: string) {
  const listPath = path.join(path.dirname(outputPath), 'slides.txt');
  const lines: string[] = [];
  for (const slidePath of slidePaths) {
    lines.push(concatFileLine(slidePath));
    lines.push('duration 4.2');
  }
  lines.push(concatFileLine(slidePaths[slidePaths.length - 1]));
  fs.writeFileSync(listPath, lines.join('\n'), 'utf8');

  await run('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-vf', 'fps=30,format=yuv420p',
    '-movflags', '+faststart',
    outputPath
  ], { timeoutMs: 180000 });
}

function normalizeNewsVideoRequest(body: Record<string, unknown>): NewsVideoRequest {
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) throw new Error('Cần nhập URL bài báo.');
  return {
    url,
    format: body.format === 'landscape' ? 'landscape' : 'short',
    language: body.language === 'en' ? 'en' : 'vi',
    tone: body.tone === 'social' || body.tone === 'executive' ? body.tone : 'newsroom',
    autoPublish: body.autoPublish === true
  };
}

async function createNewsVideoDraft(body: Record<string, unknown>) {
  const request = normalizeNewsVideoRequest(body);
  const { id, jobDir } = createUtilityDir();
  const article = await fetchArticle(request.url);
  const storyboard = buildNewsStoryboard(article, request);
  const imageBuffer = await downloadImageBuffer(article.imageUrl);
  const slidePaths: string[] = [];

  for (const [index, slide] of storyboard.slides.entries()) {
    const slidePath = path.join(jobDir, `news-slide-${String(index + 1).padStart(2, '0')}.png`);
    await createNewsSlide(slide, article, slidePath, index, storyboard.slides.length, request.format, imageBuffer);
    slidePaths.push(slidePath);
  }

  const videoPath = path.join(jobDir, `news-video-${request.format}.mp4`);
  await renderNewsVideo(slidePaths, videoPath);

  const scriptPath = path.join(jobDir, 'news-script.txt');
  const draftPath = path.join(jobDir, 'news-draft.json');
  fs.writeFileSync(scriptPath, storyboard.voiceover, 'utf8');
  fs.writeFileSync(draftPath, JSON.stringify({
    id,
    status: request.autoPublish ? 'ready_for_auto_publish' : 'pending_approval',
    compliance: {
      sourceAttributionRequired: true,
      imageRightsMustBeVerified: Boolean(article.imageUrl),
      note: 'Bản nháp dùng nội dung tóm tắt và attribution. Hãy kiểm tra quyền ảnh/bài viết trước khi đăng công khai.'
    },
    publishPlan: {
      youtube: request.autoPublish ? 'queued_after_approval_token_setup' : 'manual_approval_required',
      tiktok: request.autoPublish ? 'queued_after_approval_token_setup' : 'manual_approval_required',
      sheet: 'ready_to_sync_when_google_sheet_connector_is_configured'
    },
    request,
    article,
    keyPoints: storyboard.keyPoints,
    slides: storyboard.slides
  }, null, 2), 'utf8');

  return {
    id,
    status: request.autoPublish ? 'ready_for_auto_publish' : 'pending_approval',
    article,
    keyPoints: storyboard.keyPoints,
    slides: storyboard.slides,
    script: storyboard.voiceover,
    publishPlan: {
      youtube: request.autoPublish ? 'queued_after_approval_token_setup' : 'manual_approval_required',
      tiktok: request.autoPublish ? 'queued_after_approval_token_setup' : 'manual_approval_required',
      sheet: 'ready_to_sync_when_google_sheet_connector_is_configured'
    },
    files: [
      fileToDownload(id, videoPath),
      fileToDownload(id, slidePaths[0]),
      fileToDownload(id, scriptPath),
      fileToDownload(id, draftPath)
    ]
  };
}

async function processJob(job: ConvertJob) {
  try {
    updateJob(job, { status: 'running', progress: 3, step: 'Validating URL' });

    const host = getSupportedHost(job.options.url);
    if (!host) {
      throw new Error('URL is not supported. Use a YouTube, YouTube Music, or TikTok link.');
    }
    const isYouTube = host.includes('youtu');

    updateJob(job, { progress: 6, step: `Preparing ${job.options.format.toUpperCase()} job` });

    const args = [
      '--encoding',
      'utf-8',
      // The node JS runtime + remote EJS solver are for YouTube's n-signature
      // challenge. They BREAK TikTok's challenge extraction ("Unable to extract
      // universal data for rehydration"), so apply them only for YouTube.
      ...(isYouTube
        ? ['--js-runtimes', 'node', '--remote-components', 'ejs:github', ...youtubeExtractorArgs()]
        : []),
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      '--retry-sleep',
      'fragment:exp=1:20',
      ...ytdlpAuthArgs(),
      '--windows-filenames',
      '--no-mtime',
      '--newline',
      '--paths',
      job.jobDir,
      '--match-filter',
      `duration <= ${PUBLIC_MAX_MEDIA_SECONDS}`,
      job.options.playlist === 'playlist' ? '--yes-playlist' : '--no-playlist',
      ...(job.options.playlist === 'playlist' ? ['--playlist-end', String(PUBLIC_MAX_PLAYLIST_ITEMS)] : []),
      ...buildFormatArgs(job.options),
      '-o',
      outputTemplate(job.options.filename),
      job.options.url
    ];

    const ytdlpRunner = await resolveYtdlpRunner();
    updateJob(job, { progress: 10, step: 'Starting yt-dlp' });
    await run(ytdlpRunner.command, [...ytdlpRunner.argsPrefix, ...args], {
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
    const rawError = error instanceof Error ? error.message : 'Unknown conversion error.';
    updateJob(job, {
      status: 'failed',
      progress: 100,
      step: 'Failed',
      error: humanizeYtdlpError(rawError)
    });
    if (job.error !== rawError) addLog(job, job.error || 'Unknown conversion error.');
    addLog(job, rawError);
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
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      ...corsHeaders()
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
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      // Probe python for opencv + LaMa availability
      const probeLama = async (): Promise<{ opencv: boolean; lama: boolean }> => {
        const candidates = ['python', 'python3', 'py'];
        for (const cmd of candidates) {
          if (!(await hasCommand(cmd, ['--version'], 5000))) continue;
          const opencv = await hasCommand(cmd, ['-c', 'import cv2'], 6000);
          const lama = await hasCommand(cmd, ['-c', 'from simple_lama_inpainting import SimpleLama'], 8000);
          if (opencv || lama) return { opencv, lama };
        }
        return { opencv: false, lama: false };
      };
      const probeScanOcr = async (): Promise<boolean> => {
        if (!(await findTesseractCommand())) return false;
        return Boolean(await findPythonForScanOcr());
      };

      const [ytdlpReady, ffmpegReady, ffprobeReady, libreOfficeReady, pdf2docxReady, scanOcrReady, rembgReady, fasterWhisperReady, whisperReady, demucsReady, inpaintProbe, ocrmypdfReady] = await Promise.all([
        hasYtdlp(),
        hasCommand('ffmpeg', ['-version'], 5000),
        hasCommand('ffprobe', ['-version'], 5000),
        hasCommand(SOFFICE, libreOfficeHealthArgs(), 12000),
        hasCommand('pdf2docx', ['--help'], 12000),
        probeScanOcr(),
        hasCommand('rembg', ['--version'], 8000),
        hasCommand('faster-whisper', ['--help'], 6000),
        hasCommand('whisper', ['--help'], 6000),
        isDemucsReady((cmd, args) => hasCommand(cmd, args, 8000)),
        probeLama(),
        findOcrmypdfCommand().then((c) => Boolean(c))
      ]);

      sendJson(res, 200, {
        ready: ytdlpReady && ffmpegReady && ffprobeReady,
        ytdlpReady,
        ffmpegReady,
        ffprobeReady,
        libreOfficeReady,
        pdf2docxReady,
        scanOcrReady,
        ocrmypdfReady,
        rembgReady,
        whisperReady: fasterWhisperReady || whisperReady,
        demucsReady,
        opencvReady: inpaintProbe.opencv,
        lamaReady: inpaintProbe.lama,
        ytdlpCookiesReady: Boolean(resolveYtdlpCookiesPath() || process.env.YTDLP_COOKIES_FROM_BROWSER),
        publicLimits: {
          rateWindowSeconds: Math.round(PUBLIC_RATE_WINDOW_MS / 1000),
          maxJobsPerWindow: PUBLIC_RATE_MAX_JOBS,
          maxActiveJobs: PUBLIC_MAX_ACTIVE_JOBS,
          maxMediaSeconds: PUBLIC_MAX_MEDIA_SECONDS,
          maxPlaylistItems: PUBLIC_MAX_PLAYLIST_ITEMS
        },
        openAIReady: Boolean(process.env.OPENAI_API_KEY),
        voiceCloneReady: Boolean(resolveTtsPython()),
        vietnameseVoiceReady: Boolean(resolveVixttsDir()),
        nodeVersion: process.version,
        message: ytdlpReady && ffmpegReady && ffprobeReady ? 'Ready' : 'Missing required tools'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/content/news-video') {
      const result = await createNewsVideoDraft(await parseBody(req));
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/transcript') {
      const body = await parseBody(req) as { url?: string; languages?: string[]; useWhisper?: boolean };
      const inputUrl = String(body.url || '').trim();
      if (!inputUrl) {
        sendJson(res, 400, { error: 'URL không được trống.' });
        return;
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(inputUrl);
      } catch {
        sendJson(res, 400, { error: 'URL không hợp lệ.' });
        return;
      }
      if (!/^https?:$/.test(parsedUrl.protocol)) {
        sendJson(res, 400, { error: 'URL phải bắt đầu với http(s)://' });
        return;
      }

      const languages = Array.isArray(body.languages) && body.languages.length
        ? body.languages.map((lang) => String(lang).trim()).filter(Boolean).slice(0, 4)
        : ['vi', 'en'];

      try {
        const ytdlpRunner = await resolveYtdlpRunner();
        const result: TranscriptResult = await fetchTranscriptWithYtdlp(
          inputUrl,
          languages,
          async (args, opts) => run(ytdlpRunner.command, [...ytdlpRunner.argsPrefix, ...args], opts),
          DOWNLOAD_DIR,
          (command, args) => hasCommand(command, args, 6000),
          { useWhisper: body.useWhisper === true }
        );
        sendJson(res, 200, result);
      } catch (error) {
        const raw = error instanceof Error ? error.message : 'Trích script thất bại.';
        const friendly = humanizeYtdlpError(raw);
        console.error('[transcript] error:', raw.slice(0, 500));
        sendJson(res, 502, { error: friendly, rawError: raw.slice(0, 800) });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/audio/stems') {
      const body = await parseBody(req) as { url?: string; model?: string };
      const inputUrl = String(body.url || '').trim();
      if (!inputUrl) {
        sendJson(res, 400, { error: 'URL không được trống.' });
        return;
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(inputUrl);
      } catch {
        sendJson(res, 400, { error: 'URL không hợp lệ.' });
        return;
      }
      if (!/^https?:$/.test(parsedUrl.protocol)) {
        sendJson(res, 400, { error: 'URL phải bắt đầu với http(s)://' });
        return;
      }

      const allowedModels = ['htdemucs', 'htdemucs_ft', 'mdx_extra'] as const;
      type ModelName = typeof allowedModels[number];
      const requestedModel = String(body.model || 'htdemucs') as ModelName;
      const model: ModelName = allowedModels.includes(requestedModel) ? requestedModel : 'htdemucs';

      const { jobId, jobDir } = newStemsJobDir(DOWNLOAD_DIR);

      try {
        const ytdlpRunner = await resolveYtdlpRunner();
        const result: StemsResult = await separateStems({
          url: inputUrl,
          jobDir,
          jobId,
          downloadsBase: '/downloads',
          model,
          runYtdlp: async (args, opts) => run(ytdlpRunner.command, [...ytdlpRunner.argsPrefix, ...args], opts),
          runCommand: async (command, args, opts) => run(command, args, opts || {}),
          hasCommand: (command, args) => hasCommand(command, args, 8000)
        });
        sendJson(res, 200, result);
      } catch (error) {
        const raw = error instanceof Error ? error.message : 'Tách stems thất bại.';
        const code = (error as { code?: string })?.code;
        const status = code === 'DEMUCS_NOT_INSTALLED' ? 503 : 502;
        console.error('[stems] error:', raw.slice(0, 500));
        sendJson(res, status, { error: humanizeYtdlpError(raw), rawError: raw.slice(0, 800), code });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/voice-clone') {
      const upload = await parseMultipartUpload(req, { validateTool: false });
      const cleanup = () => fs.rmSync(upload.jobDir, { recursive: true, force: true });
      if (!upload.files.length) {
        cleanup();
        sendJson(res, 400, { error: 'Cần upload 1 file giọng mẫu (audio) để nhân bản.' });
        return;
      }
      const text = String(upload.options.text || '').trim();
      if (!text) {
        cleanup();
        sendJson(res, 400, { error: 'Cần nhập nội dung cần đọc (text).' });
        return;
      }
      if (text.length > 1000) {
        cleanup();
        sendJson(res, 400, { error: 'Nội dung quá dài (tối đa 1000 ký tự cho mỗi lần tạo).' });
        return;
      }
      const lang = pickString(upload.options.lang,
        ['vi', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'ru', 'nl', 'ja', 'zh-cn', 'ko'] as const, 'en');

      const ttsPython = resolveTtsPython();
      const cloneScript = path.join(ROOT, 'scripts', 'voice_clone.py');
      if (!ttsPython || !fs.existsSync(cloneScript)) {
        cleanup();
        sendJson(res, 503, {
          error: 'Engine nhân bản giọng (Coqui XTTS) chưa được cài. Tạo venv .venv-tts và "pip install coqui-tts".',
          code: 'TTS_NOT_INSTALLED'
        });
        return;
      }

      const vixttsDir = resolveVixttsDir();
      if (lang === 'vi' && !vixttsDir) {
        cleanup();
        sendJson(res, 400, {
          error: 'XTTS-v2 mặc định không hỗ trợ tiếng Việt. Tải model viXTTS vào data/vixtts (config.json + model.pth + vocab.json) hoặc chọn ngôn ngữ khác.',
          code: 'VI_MODEL_MISSING'
        });
        return;
      }

      try {
        // Normalize the reference sample to mono 22.05kHz WAV for stable cloning.
        const refWav = path.join(upload.jobDir, 'reference.wav');
        await run('ffmpeg', ['-y', '-i', upload.files[0].filePath, '-ac', '1', '-ar', '22050', refWav], { timeoutMs: 60000 });

        const outWav = path.join(upload.jobDir, 'voice-clone.wav');
        const args = [cloneScript, refWav, text, outWav, '--lang', lang];
        if (vixttsDir) args.push('--model-dir', vixttsDir);
        await run(ttsPython, args, {
          timeoutMs: 12 * 60 * 1000,
          env: { ...process.env, COQUI_TOS_AGREED: '1' }
        });

        if (!fs.existsSync(outWav) || fs.statSync(outWav).size < 200) {
          throw new Error('Engine không tạo được audio.');
        }
        sendJson(res, 200, {
          id: upload.id,
          status: 'completed',
          files: [fileToDownload(upload.id, outWav)]
        });
      } catch (error) {
        cleanup();
        const raw = error instanceof Error ? error.message : 'Nhân bản giọng thất bại.';
        console.error('[voice-clone] error:', raw.slice(0, 500));
        sendJson(res, 502, { error: raw.slice(0, 300) });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/news/feed') {
      const articles = newsStore.getAll().map(publicArticle);
      sendJson(res, 200, {
        articles,
        lastRefreshAt: newsStore.getLastRefreshAt(),
        total: articles.length
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/news/refresh') {
      const summary = await refreshNewsFeed(newsStore);
      sendJson(res, 200, {
        ...summary,
        lastRefreshAt: newsStore.getLastRefreshAt()
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/news/articles/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/news/articles/'.length).split('/')[0] || '');
      if (!id) {
        sendJson(res, 400, { error: 'Missing article id.' });
        return;
      }
      const article = newsStore.get(id);
      if (!article) {
        sendJson(res, 404, { error: 'Article not found.' });
        return;
      }
      sendJson(res, 200, publicArticle(article));
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/news/articles/')) {
      const parts = url.pathname.slice('/api/news/articles/'.length).split('/').filter(Boolean);
      const id = decodeURIComponent(parts[0] || '');
      const action = parts[1] || '';
      const article = newsStore.get(id);
      if (!article) {
        sendJson(res, 404, { error: 'Article not found.' });
        return;
      }
      if (action === 'extract') {
        const updated = await reenrichArticle(newsStore, id);
        sendJson(res, 200, updated ? publicArticle(updated) : { error: 'Update failed.' });
        return;
      }
      if (action === 'approve') {
        const updated = newsStore.update(id, { status: 'approved', error: null });
        sendJson(res, 200, updated ? publicArticle(updated) : { error: 'Update failed.' });
        return;
      }
      if (action === 'reject') {
        const updated = newsStore.update(id, { status: 'rejected', error: null });
        sendJson(res, 200, updated ? publicArticle(updated) : { error: 'Update failed.' });
        return;
      }
      sendJson(res, 400, { error: `Unknown action: ${action}` });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/file-jobs') {
      const upload = await parseMultipartUpload(req);
      const items: Array<{ input: string; files?: JobFile[]; error?: string }> = [];
      const allFiles: JobFile[] = [];

      // merge-pdf consumes all uploaded files and produces ONE merged PDF
      if (upload.tool === 'merge-pdf' && upload.files.length > 1) {
        try {
          const baseName = path.parse(upload.files[0].originalName).name;
          const outputPath = path.join(upload.jobDir, `${baseName}-merged.pdf`);
          await mergePdf(upload.files.map((file) => file.filePath), outputPath);
          const download = fileToDownload(upload.id, outputPath);
          const inputsLabel = `${upload.files.length} PDF → ${path.basename(outputPath)}`;
          items.push({ input: inputsLabel, files: [download] });
          allFiles.push(download);
        } catch (error) {
          items.push({
            input: upload.files.map((f) => f.originalName).join(', '),
            error: error instanceof Error ? error.message : 'PDF merge failed.'
          });
        }
      } else {
        for (const uploaded of upload.files) {
          try {
            const outputPath = await processFileConversion(upload.tool, uploaded.filePath, upload.jobDir, upload.options);
            const outputPaths = Array.isArray(outputPath) ? outputPath : [outputPath];
            const downloads = outputPaths.map((p) => fileToDownload(upload.id, p));
            items.push({ input: uploaded.originalName, files: downloads });
            allFiles.push(...downloads);
          } catch (error) {
            items.push({
              input: uploaded.originalName,
              error: error instanceof Error ? error.message : 'Conversion failed.'
            });
          }
        }
      }

      if (allFiles.length === 0) {
        fs.rmSync(upload.jobDir, { recursive: true, force: true });
        const firstError = items.find((item) => item.error)?.error || 'All conversions failed.';
        throw new Error(firstError);
      }

      const status = items.every((item) => !item.error) ? 'completed' : 'partial';
      sendJson(res, 200, {
        id: upload.id,
        status,
        tool: upload.tool,
        input: items[0]?.input ?? '',
        items,
        files: allFiles
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/detect-objects') {
      const upload = await parseMultipartUpload(req);
      if (!upload.files.length) {
        fs.rmSync(upload.jobDir, { recursive: true, force: true });
        sendJson(res, 400, { error: 'Cần upload 1 ảnh để phát hiện vật thể.' });
        return;
      }
      const imagePath = upload.files[0].filePath;
      const detectScript = path.join(ROOT, 'scripts', 'detect_objects.py');
      if (!fs.existsSync(detectScript)) {
        sendJson(res, 500, { error: 'Thiếu scripts/detect_objects.py' });
        return;
      }

      // Find python with ultralytics
      const pyCandidates = ['python', 'python3', 'py'];
      let pyCmd: string | null = null;
      for (const c of pyCandidates) {
        if (!(await hasCommand(c, ['--version'], 5000))) continue;
        if (await hasCommand(c, ['-c', 'import ultralytics'], 12000)) { pyCmd = c; break; }
      }
      if (!pyCmd) {
        sendJson(res, 503, {
          error: 'Auto phát hiện vật thể cần YOLOv8. Cài: pip install ultralytics. Hoặc dùng Manual brush.',
          code: 'YOLO_NOT_INSTALLED'
        });
        return;
      }

      const model = pickString(upload.options.detectModel, ['yolov8x-seg.pt', 'yolov8l-seg.pt', 'yolov8m-seg.pt', 'yolov8n-seg.pt'] as const, 'yolov8m-seg.pt');
      try {
        const { stdout } = await run(pyCmd, [
          detectScript, imagePath, upload.jobDir, '--conf', '0.30', '--model', model
        ], { timeoutMs: 5 * 60 * 1000 });
        const jsonLine = stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
        if (!jsonLine) throw new Error('Detection không trả JSON.');
        const detection = JSON.parse(jsonLine) as {
          width: number; height: number; error?: string;
          objects: Array<{ id: number; label: string; confidence: number; bbox: number[]; area_pct: number; cx: number; cy: number; is_main: boolean; mask_file: string }>;
          secondary_mask_file: string | null;
          main_count?: number; secondary_count?: number;
        };
        if (detection.error) throw new Error(detection.error);

        const labelVi: Record<string, string> = {
          person: 'Người', bicycle: 'Xe đạp', car: 'Ô tô', motorcycle: 'Xe máy',
          bus: 'Xe buýt', truck: 'Xe tải', dog: 'Chó', cat: 'Mèo', bird: 'Chim',
          'potted plant': 'Cây cảnh', chair: 'Ghế', bench: 'Băng ghế', umbrella: 'Ô dù',
          backpack: 'Ba lô', handbag: 'Túi xách', bottle: 'Chai', cup: 'Cốc',
          'traffic light': 'Đèn giao thông', boat: 'Thuyền', horse: 'Ngựa', train: 'Tàu'
        };

        sendJson(res, 200, {
          jobId: upload.id,
          width: detection.width,
          height: detection.height,
          imageUrl: `/downloads/${upload.id}/${encodeURIComponent(upload.files[0].originalName)}`,
          mainCount: detection.main_count ?? 0,
          secondaryCount: detection.secondary_count ?? 0,
          secondaryMaskUrl: detection.secondary_mask_file
            ? `/downloads/${upload.id}/${encodeURIComponent(detection.secondary_mask_file)}`
            : null,
          objects: detection.objects.map((o) => ({
            id: o.id,
            label: o.label,
            labelVi: labelVi[o.label] || o.label,
            confidence: o.confidence,
            bbox: o.bbox,
            areaPct: o.area_pct,
            cx: o.cx,
            cy: o.cy,
            isMain: o.is_main,
            maskUrl: `/downloads/${upload.id}/${encodeURIComponent(o.mask_file)}`
          }))
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : 'Phát hiện vật thể thất bại.';
        console.error('[detect-objects] error:', raw.slice(0, 500));
        sendJson(res, 502, { error: raw.slice(0, 300) });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/preview/')) {
      const parts = url.pathname.slice('/api/preview/'.length).split('/').filter(Boolean);
      if (parts.length !== 2) {
        sendJson(res, 400, { error: 'Preview path must be /api/preview/{id}/{filename}.' });
        return;
      }
      const [id, filename] = parts.map(decodeURIComponent);
      const filePath = path.resolve(DOWNLOAD_DIR, id, filename);
      const downloadsRoot = path.resolve(DOWNLOAD_DIR);
      if (!filePath.startsWith(`${downloadsRoot}${path.sep}`)) {
        sendJson(res, 403, { error: 'Forbidden.' });
        return;
      }
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'File not found.' });
        return;
      }
      try {
        const preview = await buildPreview(filePath);
        sendJson(res, 200, preview);
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Preview failed.' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/zip/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/zip/'.length).split('/')[0] || '');
      if (!/^[\w-]+$/.test(id)) {
        sendJson(res, 400, { error: 'Invalid job id.' });
        return;
      }
      const jobDir = path.resolve(DOWNLOAD_DIR, id);
      const downloadsRoot = path.resolve(DOWNLOAD_DIR);
      if (!jobDir.startsWith(`${downloadsRoot}${path.sep}`) || !fs.existsSync(jobDir) || !fs.statSync(jobDir).isDirectory()) {
        sendJson(res, 404, { error: 'Job not found.' });
        return;
      }
      try {
        const requestedNames = url.searchParams.getAll('file');
        const entryNames = requestedNames.length
          ? requestedNames
          : fs.readdirSync(jobDir).filter((name) => {
            const full = path.join(jobDir, name);
            return fs.statSync(full).isFile() && !name.startsWith('.') && !name.endsWith('.part');
          });
        const entries: ZipEntry[] = entryNames
          .map((name) => path.basename(name))
          .filter((name) => {
            const full = path.join(jobDir, name);
            return fs.existsSync(full) && fs.statSync(full).isFile();
          })
          .map((name) => ({ name, data: fs.readFileSync(path.join(jobDir, name)) }));
        if (!entries.length) {
          sendJson(res, 404, { error: 'No files to archive.' });
          return;
        }
        const zip = buildZip(entries);
        const downloadName = `convert-${id.slice(0, 8)}.zip`;
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': String(zip.length),
          'Content-Disposition': `attachment; filename="${downloadName}"`,
          'Cache-Control': 'no-store',
          ...corsHeaders()
        });
        res.end(zip);
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Zip failed.' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const payload = normalizePayload(await parseBody(req));
      const clientIp = getClientIp(req);
      assertMediaJobQuota(clientIp);
      const job = createJob(payload, clientIp);
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
