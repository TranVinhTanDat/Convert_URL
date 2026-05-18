export type OutputFormat = 'mp4' | 'mp3';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface HealthResponse {
  ready: boolean;
  ytdlpReady: boolean;
  ffmpegReady: boolean;
  ffprobeReady: boolean;
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
