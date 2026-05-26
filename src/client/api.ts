import type {
  ConvertJob,
  CreateJobPayload,
  FileConversionResult,
  FileToolId,
  HealthResponse,
  NewsArticle,
  NewsFeedResponse,
  NewsRefreshResponse,
  NewsVideoRequest,
  NewsVideoResult,
  PreviewPayload,
  TranscriptResult
} from './types';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function apiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error('Server không trả dữ liệu. Hãy kiểm tra backend còn chạy và thử lại.');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 800) || 'Server trả về dữ liệu không phải JSON.');
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), options);
  const data = await readJsonResponse<T & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(data.error || 'Yêu cầu thất bại.');
  }

  return data;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

export function createJob(payload: CreateJobPayload): Promise<ConvertJob> {
  return request<ConvertJob>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function getJob(jobId: string): Promise<ConvertJob> {
  return request<ConvertJob>(`/api/jobs/${jobId}`);
}

export function convertFile(tool: FileToolId, file: File, options?: Record<string, unknown>): Promise<FileConversionResult> {
  return convertFiles(tool, [file], options);
}

export function convertFiles(tool: FileToolId, files: File[], options?: Record<string, unknown>): Promise<FileConversionResult> {
  const body = new FormData();
  body.append('tool', tool);
  if (options && Object.keys(options).length) {
    body.append('options', JSON.stringify(options));
  }
  for (const file of files) {
    body.append('file', file, file.name);
  }

  return request<FileConversionResult>('/api/file-jobs', {
    method: 'POST',
    body
  });
}

export function getPreview(downloadUrl: string): Promise<PreviewPayload> {
  if (!downloadUrl.startsWith('/downloads/')) {
    return Promise.reject(new Error('Invalid preview path.'));
  }
  const previewPath = downloadUrl.replace(/^\/downloads\//, '/api/preview/');
  return request<PreviewPayload>(previewPath);
}

export function createNewsVideo(payload: NewsVideoRequest): Promise<NewsVideoResult> {
  return request<NewsVideoResult>('/api/content/news-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function zipUrl(jobId: string, fileNames?: string[]): string {
  const base = `${apiBaseUrl}/api/zip/${encodeURIComponent(jobId)}`;
  if (!fileNames || fileNames.length === 0) return base;
  const params = fileNames.map((name) => `file=${encodeURIComponent(name)}`).join('&');
  return `${base}?${params}`;
}

export function getNewsFeed(): Promise<NewsFeedResponse> {
  return request<NewsFeedResponse>('/api/news/feed');
}

export function refreshNews(): Promise<NewsRefreshResponse> {
  return request<NewsRefreshResponse>('/api/news/refresh', { method: 'POST' });
}

export function getNewsArticle(id: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/api/news/articles/${encodeURIComponent(id)}`);
}

export function extractArticle(id: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/api/news/articles/${encodeURIComponent(id)}/extract`, { method: 'POST' });
}

export function approveArticle(id: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/api/news/articles/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export function rejectArticle(id: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/api/news/articles/${encodeURIComponent(id)}/reject`, { method: 'POST' });
}

export function fetchTranscript(payload: { url: string; languages?: string[]; useWhisper?: boolean }): Promise<TranscriptResult> {
  return request<TranscriptResult>('/api/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
