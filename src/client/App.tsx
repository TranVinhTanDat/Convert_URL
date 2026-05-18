import { AlertTriangle, CheckCircle2, Clipboard, Download, Link2, Loader2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createJob, getHealth, getJob } from './api';
import type { ConvertJob, CreateJobPayload, HealthResponse, OutputFormat } from './types';

const initialJob: ConvertJob = {
  id: '',
  status: 'queued',
  progress: 0,
  step: 'Chưa có job nào.',
  logs: [],
  files: [],
  error: null,
  createdAt: '',
  updatedAt: ''
};

function formatBytes(bytes: number): string {
  if (!bytes) return '';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function statusTitle(job: ConvertJob): string {
  if (!job.id) return 'Sẵn sàng';
  if (job.status === 'completed') return 'Hoàn tất';
  if (job.status === 'failed') return 'Có lỗi xảy ra';
  return 'Đang chuyển đổi';
}

export function App() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<OutputFormat>('mp4');
  const [quality, setQuality] = useState('best');
  const [playlist, setPlaylist] = useState<CreateJobPayload['playlist']>('single');
  const [filename, setFilename] = useState<CreateJobPayload['filename']>('title');
  const [compatibility, setCompatibility] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState('');
  const [job, setJob] = useState<ConvertJob>(initialJob);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const logs = useMemo(() => {
    const lines = job.error ? [...job.logs, job.error] : job.logs;
    return lines.length ? lines.join('\n') : 'Log sẽ xuất hiện tại đây.';
  }, [job]);

  useEffect(() => {
    getHealth()
      .then((data) => {
        setHealth(data);
        setHealthError('');
      })
      .catch((error: Error) => {
        setHealth(null);
        setHealthError(error.message);
      });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, []);

  async function pollJob(jobId: string) {
    try {
      const nextJob = await getJob(jobId);
      setJob(nextJob);

      if (nextJob.status === 'completed' || nextJob.status === 'failed') {
        if (pollTimer.current) window.clearInterval(pollTimer.current);
        pollTimer.current = null;
        setBusy(false);
      }
    } catch (error) {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
      setBusy(false);
      setJob((current) => ({
        ...current,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Mất kết nối tới backend.',
        step: 'Mất kết nối'
      }));
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      setJob((current) => ({
        ...current,
        status: 'failed',
        error: 'Trình duyệt không cho phép đọc clipboard. Bạn có thể dán thủ công bằng Ctrl+V.'
      }));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pollTimer.current) window.clearInterval(pollTimer.current);

    setBusy(true);
    setJob({
      ...initialJob,
      id: 'pending',
      status: 'queued',
      step: 'Đang tạo job...',
      logs: ['Đang gửi yêu cầu tới backend...']
    });

    const payload: CreateJobPayload = {
      url: url.trim(),
      format,
      quality,
      playlist,
      filename,
      compatibility: compatibility ? 'compatible' : 'source'
    };

    try {
      const created = await createJob(payload);
      setJob(created);
      pollTimer.current = window.setInterval(() => pollJob(created.id), 1000);
      pollJob(created.id);
    } catch (error) {
      setBusy(false);
      setJob({
        ...initialJob,
        id: 'failed',
        status: 'failed',
        step: 'Không tạo được job',
        error: error instanceof Error ? error.message : 'Không tạo được job.'
      });
    }
  }

  const ready = Boolean(health?.ready);
  const healthMessage = ready
    ? `Node ${health?.nodeVersion}, yt-dlp, ffmpeg và ffprobe đã sẵn sàng.`
    : healthError || health?.message || 'Đang đọc trạng thái công cụ...';

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Link2 size={24} />
            </span>
            <span>Convert URL Studio</span>
          </div>
          <h1>Chuyển URL sang MP4/MP3 sạch, rõ, dễ mở trên mọi máy.</h1>
          <p className="hero-copy">
            Frontend React + TypeScript, backend Node job runner, yt-dlp và ffmpeg cục bộ. MP4 mặc định được chuẩn hóa
            H.264/AAC để tránh lỗi Missing codec trên Windows.
          </p>
        </div>

        <div className="health-card" aria-live="polite">
          <div className={`health-dot ${ready ? 'ready' : health || healthError ? 'missing' : ''}`} />
          <div>
            <strong>{ready ? 'Sẵn sàng' : health || healthError ? 'Cần kiểm tra' : 'Đang kiểm tra'}</strong>
            <span>{healthMessage}</span>
          </div>
        </div>
      </section>

      <section className="workspace">
        <form className="converter-panel" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="urlInput">URL video</label>
            <div className="input-action">
              <input
                id="urlInput"
                type="url"
                placeholder="Dán link YouTube hoặc TikTok..."
                autoComplete="off"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
              <button className="icon-button" type="button" title="Dán từ clipboard" aria-label="Dán từ clipboard" onClick={handlePaste}>
                <Clipboard size={21} />
              </button>
            </div>
          </div>

          <div className="field">
            <label>Định dạng</label>
            <div className="segmented" role="tablist" aria-label="Định dạng xuất file">
              <button type="button" className={format === 'mp4' ? 'active' : ''} onClick={() => setFormat('mp4')}>
                MP4
              </button>
              <button type="button" className={format === 'mp3' ? 'active' : ''} onClick={() => setFormat('mp3')}>
                MP3
              </button>
            </div>
          </div>

          <div className="settings-grid">
            <div className="field">
              <label htmlFor="qualitySelect">Chất lượng</label>
              <select id="qualitySelect" value={quality} onChange={(event) => setQuality(event.target.value)} disabled={format === 'mp3'}>
                <option value="best">Tốt nhất</option>
                <option value="2160">2160p</option>
                <option value="1440">1440p</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="playlistSelect">Phạm vi</label>
              <select id="playlistSelect" value={playlist} onChange={(event) => setPlaylist(event.target.value as CreateJobPayload['playlist'])}>
                <option value="single">Một video</option>
                <option value="playlist">Playlist nếu có</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="filenameSelect">Tên file</label>
              <select id="filenameSelect" value={filename} onChange={(event) => setFilename(event.target.value as CreateJobPayload['filename'])}>
                <option value="title">Tiêu đề + ID</option>
                <option value="id">Chỉ ID</option>
              </select>
            </div>
          </div>

          <label className={`switch-row ${format === 'mp3' ? 'disabled' : ''}`} htmlFor="compatibilityToggle">
            <input
              id="compatibilityToggle"
              type="checkbox"
              checked={compatibility}
              disabled={format === 'mp3'}
              onChange={(event) => setCompatibility(event.target.checked)}
            />
            <span className="switch-ui" aria-hidden="true" />
            <span>
              <strong>MP4 tương thích cao</strong>
              <small>Chuẩn hóa sang H.264/AAC để mở tốt trên Windows, điện thoại và trình duyệt.</small>
            </span>
          </label>

          <div className="notice">
            <AlertTriangle size={20} />
            <span>Chỉ chuyển đổi nội dung bạn sở hữu, có giấy phép, hoặc được tác giả cho phép.</span>
          </div>

          <button className="primary-button" type="submit" disabled={busy || !ready}>
            {busy ? <Loader2 className="spin" size={21} /> : <Download size={21} />}
            {busy ? 'Đang xử lý...' : 'Bắt đầu chuyển đổi'}
          </button>
        </form>

        <aside className="status-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Tiến trình</span>
              <h2>{statusTitle(job)}</h2>
            </div>
            <span className={`job-badge ${job.status}`}>{job.id ? job.status : 'idle'}</span>
          </div>

          <div className="progress-shell">
            <div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
          </div>
          <div className="progress-meta">
            <span>{job.step}</span>
            <strong>{Math.max(0, Math.min(100, job.progress))}%</strong>
          </div>

          <div className="downloads">
            {job.files.map((file) => (
              <a className="download-link" href={file.downloadUrl} download={file.fileName} key={file.downloadUrl}>
                <span>
                  <CheckCircle2 size={18} />
                  {file.fileName}
                </span>
                <small>{formatBytes(file.size)}</small>
              </a>
            ))}
          </div>

          <div className={`log-box ${job.status === 'failed' ? 'error' : ''}`} ref={logRef}>
            {logs}
          </div>
        </aside>
      </section>
    </main>
  );
}
