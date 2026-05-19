import type { ConvertJob, CreateJobPayload, FileConversionResult, FileToolId, HealthResponse } from './types';

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

export function convertFile(tool: FileToolId, file: File): Promise<FileConversionResult> {
  const body = new FormData();
  body.append('tool', tool);
  body.append('file', file);

  return request<FileConversionResult>('/api/file-jobs', {
    method: 'POST',
    body
  });
}
