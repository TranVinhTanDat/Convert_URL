export type OutputFormat = 'mp4' | 'mp3';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type NewsVideoStatus = 'pending_approval' | 'ready_for_auto_publish';

export interface HealthResponse {
  ready: boolean;
  ytdlpReady: boolean;
  ffmpegReady: boolean;
  ffprobeReady: boolean;
  libreOfficeReady: boolean;
  pdf2docxReady: boolean;
  rembgReady: boolean;
  whisperReady: boolean;
  openAIReady: boolean;
  nodeVersion: string;
  message: string;
}

export interface TranscriptSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  startLabel: string;
  endLabel: string;
  text: string;
}

export type TranscriptContentType = 'music' | 'talk' | 'tutorial' | 'news' | 'vlog' | 'gaming' | 'short' | 'video';

export interface TranscriptVideoMeta {
  title: string;
  duration: number;
  durationLabel: string;
  uploader: string | null;
  channel: string | null;
  uploadDate: string | null;
  thumbnail: string | null;
  webpageUrl: string;
  viewCount: number | null;
  host: string;
  contentType: TranscriptContentType;
  contentTypeLabel: string;
  categories: string[];
}

export interface TranscriptLanguageOption {
  code: string;
  label: string;
  auto: boolean;
}

export interface TranscriptResult {
  video: TranscriptVideoMeta;
  language: string;
  languageLabel: string;
  source: 'manual' | 'auto' | 'whisper' | 'none';
  hasSubtitles: boolean;
  availableLanguages: TranscriptLanguageOption[];
  segments: TranscriptSegment[];
  qualityWarning: string | null;
  plainText: string;
  paragraphsMarkdown: string;
  srt: string;
  vtt: string;
  message?: string;
  warning?: string;
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
  | 'scan-document'
  | 'remove-background'
  | 'chroma-key'
  | 'crop-image'
  | 'rotate-image'
  | 'filter-image'
  | 'merge-pdf'
  | 'split-pdf';

export interface FileConversionItem {
  input: string;
  files?: ConvertFile[];
  error?: string;
}

export interface FileConversionResult {
  id: string;
  status: 'completed' | 'partial';
  tool: FileToolId;
  input: string;
  items: FileConversionItem[];
  files: ConvertFile[];
}

export interface PreviewSheet {
  name: string;
  headers: string[];
  totalRows: number;
  rows: string[][];
}

export type PreviewPayload =
  | { kind: 'workbook'; sheets: PreviewSheet[] }
  | { kind: 'text'; text: string }
  | { kind: 'unsupported' };

export type ArticleStatus =
  | 'discovered'
  | 'extracting'
  | 'extract_failed'
  | 'script_ready'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'rejected';

export interface NewsArticle {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  fetchedAt: string;
  updatedAt: string;
  heroImage: string | null;
  category: string | null;
  bodyParagraphs: number;
  body: string[];
  bodyImages: string[];
  script: string | null;
  videoFile: string | null;
  audioFile: string | null;
  voiceLabel: string | null;
  status: ArticleStatus;
  error: string | null;
}

export interface NewsFeedResponse {
  articles: NewsArticle[];
  lastRefreshAt: string | null;
  total: number;
}

export interface NewsRefreshResponse {
  added: number;
  updated: number;
  total: number;
  lastRefreshAt: string;
}

export interface NewsVideoRequest {
  url: string;
  format: 'short' | 'landscape';
  language: 'vi' | 'en';
  tone: 'newsroom' | 'social' | 'executive';
  autoPublish: boolean;
}

export interface NewsArticle {
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

export interface StorySlide {
  label: string;
  headline: string;
  body: string[];
}

export interface NewsVideoResult {
  id: string;
  status: NewsVideoStatus;
  article: NewsArticle;
  keyPoints: string[];
  slides: StorySlide[];
  script: string;
  publishPlan: {
    youtube: string;
    tiktok: string;
    sheet: string;
  };
  files: ConvertFile[];
}
