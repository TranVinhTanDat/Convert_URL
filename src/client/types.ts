export type OutputFormat = 'mp4' | 'mp3';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface HealthResponse {
  ready: boolean;
  ytdlpReady: boolean;
  ffmpegReady: boolean;
  ffprobeReady: boolean;
  libreOfficeReady: boolean;
  pdf2docxReady: boolean;
  openAIReady: boolean;
  nodeVersion: string;
  message: string;
}

export interface ConvertFile {
  fileName: string;
  title: string;
  size: number;
  downloadUrl: string;
}

export interface ConvertJob {
  id: string;
  status: JobStatus;
  progress: number;
  step: string;
  logs: string[];
  files: ConvertFile[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobPayload {
  url: string;
  format: OutputFormat;
  quality: string;
  playlist: 'single' | 'playlist';
  filename: 'title' | 'id';
  compatibility: 'compatible' | 'source';
}

export type FileToolId =
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

export interface FileConversionResult {
  id: string;
  status: 'completed';
  tool: FileToolId;
  input: string;
  files: ConvertFile[];
}
