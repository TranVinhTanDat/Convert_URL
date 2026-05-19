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
  | 'scan-document';

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
  'scan-document': imageExtensions
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
}

interface LocalFile {
  name: string;
  fullPath: string;
  mtimeMs: number;
  isFile: boolean;
}

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  timeoutMs?: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = process.cwd();
const PORT = Number(process.env.PORT || appConfig.apiPort);
const DIST_CLIENT_DIR = path.join(ROOT, appConfig.paths.clientDist);
const DOWNLOAD_DIR = path.join(ROOT, appConfig.paths.downloads);
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const SOFFICE = resolveLibreOfficeCommand();
const MAX_BODY_SIZE = 128 * 1024;
const MAX_UPLOAD_SIZE = 40 * 1024 * 1024;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

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

function parseMultipartUpload(req: http.IncomingMessage): Promise<{ tool: FileTool; filePath: string; originalName: string; jobDir: string; id: string }> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (!contentType?.includes('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data upload.'));
      return;
    }

    const { id, jobDir } = createUtilityDir();
    const busboy = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: 1, fileSize: MAX_UPLOAD_SIZE, fields: 4 } });
    let tool = '' as FileTool;
    let filePath = '';
    let originalName = '';
    let uploadError: Error | null = null;
    const writePromises: Promise<void>[] = [];

    busboy.on('field', (name, value) => {
      if (name === 'tool') {
        tool = value as FileTool;
      }
    });

    busboy.on('file', (_name, file, info) => {
      originalName = safeFileName(normalizeUploadName(info.filename || 'upload'));
      filePath = path.join(jobDir, originalName);
      const writer = fs.createWriteStream(filePath);
      writePromises.push(new Promise((resolve, rejectWrite) => {
        writer.on('finish', resolve);
        writer.on('error', rejectWrite);
      }));

      file.on('limit', () => {
        uploadError = new Error('File is too large. Maximum upload size is 40 MB.');
        file.unpipe(writer);
        writer.destroy();
      });

      file.pipe(writer);
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

      if (!tool || !isFileTool(tool)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        reject(new Error('Unsupported file tool.'));
        return;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        reject(new Error('Upload must include a conversion tool and one file.'));
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      if (!fileToolExtensions[tool].includes(extension)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        reject(new Error(`File .${extension.replace('.', '') || 'unknown'} is not valid for this tool. Accepted: ${fileToolExtensions[tool].join(', ')}.`));
        return;
      }

      resolve({ tool, filePath, originalName, jobDir, id });
    });

    req.pipe(busboy);
  });
}

function worksheetToRows(worksheet: ExcelJS.Worksheet) {
  const headerRow = worksheet.getRow(1);
  const headers = headerRow.values instanceof Array
    ? headerRow.values.slice(1).map((value, index) => String(value || `Column ${index + 1}`))
    : [];
  const rows: Record<string, unknown>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const value = row.getCell(index + 1).value;
      entry[header] = typeof value === 'object' && value !== null && 'text' in value ? String(value.text) : value;
    });
    rows.push(entry);
  });

  return rows;
}

async function excelToJson(inputPath: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sheets = workbook.worksheets.map((worksheet) => ({
    name: worksheet.name,
    rows: worksheetToRows(worksheet)
  }));
  fs.writeFileSync(outputPath, JSON.stringify({ sheets }, null, 2), 'utf8');
}

async function excelToXml(inputPath: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  const xml = builder.build({
    workbook: {
      sheet: workbook.worksheets.map((worksheet) => ({
        '@_name': worksheet.name,
        row: worksheetToRows(worksheet)
      }))
    }
  });
  fs.writeFileSync(outputPath, xml, 'utf8');
}

async function excelToCsv(inputPath: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel file does not contain any worksheet.');
  await workbook.csv.writeFile(outputPath, { sheetName: worksheet.name });
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
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const parsed = parser.parse(fs.readFileSync(inputPath, 'utf8')) as unknown;
  const workbookNode = (parsed as { workbook?: { sheet?: unknown } }).workbook;

  if (workbookNode?.sheet) {
    const sheets = (Array.isArray(workbookNode.sheet) ? workbookNode.sheet : [workbookNode.sheet])
      .map((sheet, index) => {
        const sheetObject = sheet as { name?: string; row?: unknown };
        return {
          name: sheetObject.name || `Sheet${index + 1}`,
          rows: Array.isArray(sheetObject.row)
            ? sheetObject.row as Record<string, unknown>[]
            : sheetObject.row
              ? [sheetObject.row as Record<string, unknown>]
              : []
        };
      });
    await rowsToExcel(sheets, outputPath);
    return;
  }

  const rows = findRowsInXml(parsed);
  await rowsToExcel([{ name: 'XML', rows: rows.length ? rows : [parsed as Record<string, unknown>] }], outputPath);
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

async function convertImage(inputPath: string, outputPath: string, format: 'png' | 'jpeg' | 'webp' | 'avif') {
  const pipeline = imagePipeline(inputPath);

  if (format === 'png') {
    await pipeline.png({ compressionLevel: 9, palette: false }).toFile(outputPath);
    return;
  }

  if (format === 'jpeg') {
    await pipeline.jpeg({ quality: 88, mozjpeg: true }).toFile(outputPath);
    return;
  }

  if (format === 'webp') {
    await pipeline.webp({ quality: 86, effort: 5 }).toFile(outputPath);
    return;
  }

  await pipeline.avif({ quality: 62, effort: 7 }).toFile(outputPath);
}

async function compressImage(inputPath: string, outputPath: string) {
  await imagePipeline(inputPath)
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(outputPath);
}

async function resizeImage(inputPath: string, outputPath: string) {
  await imagePipeline(inputPath)
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 5 })
    .toFile(outputPath);
}

async function upscaleImage(inputPath: string, outputPath: string) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot read image dimensions.');

  await imagePipeline(inputPath)
    .resize({
      width: Math.min(metadata.width * 2, 6000),
      height: Math.min(metadata.height * 2, 6000),
      fit: 'inside',
      kernel: sharp.kernel.lanczos3
    })
    .sharpen({ sigma: 1, m1: 1.1, m2: 1.6 })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function squareThumbnail(inputPath: string, outputPath: string) {
  await imagePipeline(inputPath)
    .resize({ width: 1200, height: 1200, fit: 'contain', background: '#ffffff', withoutEnlargement: false })
    .webp({ quality: 86, effort: 5 })
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

async function pdfToPng(inputPath: string, jobDir: string) {
  const parser = new PDFParse({
    data: new Uint8Array(fs.readFileSync(inputPath)),
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false
  });

  try {
    const screenshots = await parser.getScreenshot({
      desiredWidth: 1800,
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

async function scanDocument(inputPath: string, outputPath: string) {
  await imagePipeline(inputPath)
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalise()
    .median(1)
    .sharpen({ sigma: 1.1, m1: 1.4, m2: 2.2 })
    .threshold(188)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function processFileConversion(tool: FileTool, inputPath: string, jobDir: string) {
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
      await pdfToWordEditableLayout(inputPath, outputPath);
      return outputPath;
    }
    case 'image-to-png': {
      const outputPath = safeOut('', 'png');
      await convertImage(inputPath, outputPath, 'png');
      return outputPath;
    }
    case 'image-to-jpeg': {
      const outputPath = safeOut('', 'jpg');
      await convertImage(inputPath, outputPath, 'jpeg');
      return outputPath;
    }
    case 'image-to-webp': {
      const outputPath = safeOut('', 'webp');
      await convertImage(inputPath, outputPath, 'webp');
      return outputPath;
    }
    case 'image-to-avif': {
      const outputPath = safeOut('', 'avif');
      await convertImage(inputPath, outputPath, 'avif');
      return outputPath;
    }
    case 'image-to-pdf': {
      const outputPath = out('', 'pdf');
      await imageToPdf(inputPath, outputPath);
      return outputPath;
    }
    case 'pdf-to-png': {
      return pdfToPng(inputPath, jobDir);
    }
    case 'compress-image': {
      const outputPath = out('-compressed', 'jpg');
      await compressImage(inputPath, outputPath);
      return outputPath;
    }
    case 'resize-image': {
      const outputPath = out('-1920', 'webp');
      await resizeImage(inputPath, outputPath);
      return outputPath;
    }
    case 'upscale-image': {
      const outputPath = out('-2x', 'png');
      await upscaleImage(inputPath, outputPath);
      return outputPath;
    }
    case 'square-thumbnail': {
      const outputPath = out('-square', 'webp');
      await squareThumbnail(inputPath, outputPath);
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
      await scanDocument(inputPath, outputPath);
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
      const [ytdlpReady, ffmpegReady, ffprobeReady, libreOfficeReady, pdf2docxReady] = await Promise.all([
        hasCommand(YTDLP, ['--version'], 5000),
        hasCommand('ffmpeg', ['-version'], 5000),
        hasCommand('ffprobe', ['-version'], 5000),
        hasCommand(SOFFICE, libreOfficeHealthArgs(), 12000),
        hasCommand('pdf2docx', ['--help'], 12000)
      ]);

      sendJson(res, 200, {
        ready: ytdlpReady && ffmpegReady && ffprobeReady,
        ytdlpReady,
        ffmpegReady,
        ffprobeReady,
        libreOfficeReady,
        pdf2docxReady,
        openAIReady: Boolean(process.env.OPENAI_API_KEY),
        nodeVersion: process.version,
        message: ytdlpReady && ffmpegReady && ffprobeReady ? 'Ready' : 'Missing required tools'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/file-jobs') {
      const upload = await parseMultipartUpload(req);
      try {
        const outputPath = await processFileConversion(upload.tool, upload.filePath, upload.jobDir);
        const outputPaths = Array.isArray(outputPath) ? outputPath : [outputPath];
        sendJson(res, 200, {
          id: upload.id,
          status: 'completed',
          tool: upload.tool,
          input: upload.originalName,
          files: outputPaths.map((filePath) => fileToDownload(upload.id, filePath))
        });
      } catch (error) {
        fs.rmSync(upload.jobDir, { recursive: true, force: true });
        throw error;
      }
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
