import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Image,
  Link2,
  Loader2,
  Sparkles,
  UploadCloud,
  Wand2
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { convertFile, createJob, getHealth, getJob } from './api';
import type { ConvertFile, ConvertJob, CreateJobPayload, FileToolId, HealthResponse, OutputFormat } from './types';

type ActiveTool = 'media' | 'files';
type FileGroupId = 'documents' | 'data' | 'images';

interface FileTool {
  id: FileToolId;
  title: string;
  description: string;
  accept: string;
  badge: string;
  needsLibreOffice?: boolean;
  needsPdf2Docx?: boolean;
}

const fileTools: FileTool[] = [
  {
    id: 'excel-to-json',
    title: 'Excel sang JSON',
    description: 'Xuất toàn bộ sheet thành JSON có cấu trúc, giữ tên sheet và hàng dữ liệu.',
    accept: '.xlsx',
    badge: 'Data'
  },
  {
    id: 'json-to-excel',
    title: 'JSON sang Excel',
    description: 'Nhận array/object hoặc { sheets: [...] } và tạo workbook Excel sạch.',
    accept: '.json,application/json',
    badge: 'Data'
  },
  {
    id: 'excel-to-xml',
    title: 'Excel sang XML',
    description: 'Chuyển workbook Excel thành XML có sheet và row rõ ràng.',
    accept: '.xlsx',
    badge: 'XML'
  },
  {
    id: 'xml-to-excel',
    title: 'XML sang Excel',
    description: 'Đọc XML dạng workbook hoặc XML object phổ thông rồi xuất Excel.',
    accept: '.xml,application/xml,text/xml',
    badge: 'XML'
  },
  {
    id: 'excel-to-csv',
    title: 'Excel sang CSV',
    description: 'Xuất sheet đầu tiên thành CSV nhẹ, tiện import hệ thống khác.',
    accept: '.xlsx',
    badge: 'CSV'
  },
  {
    id: 'csv-to-excel',
    title: 'CSV sang Excel',
    description: 'Đóng gói CSV thành file Excel để chia sẻ và chỉnh sửa dễ hơn.',
    accept: '.csv,text/csv',
    badge: 'CSV'
  },
  {
    id: 'word-to-pdf',
    title: 'Word sang PDF',
    description: 'Dùng LibreOffice headless để xuất DOCX/DOC sang PDF.',
    accept: '.doc,.docx',
    badge: 'Docs',
    needsLibreOffice: true
  },
  {
    id: 'pdf-to-word',
    title: 'PDF sang Word',
    description: 'Dùng pdf2docx để phục dựng DOCX có thể chỉnh sửa, giữ layout/bảng tốt nhất có thể.',
    accept: '.pdf,application/pdf',
    badge: 'Docs',
    needsPdf2Docx: true
  },
  {
    id: 'image-to-png',
    title: 'Ảnh sang PNG',
    description: 'Chuyển JPEG/PNG/WebP/TIFF/AVIF sang PNG chất lượng cao.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'image-to-jpeg',
    title: 'Ảnh sang JPEG',
    description: 'Xuất JPEG tối ưu, hợp chia sẻ và upload hệ thống cũ.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'image-to-webp',
    title: 'Ảnh sang WebP',
    description: 'Tạo WebP nhẹ, đẹp, hợp website và portfolio.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'image-to-avif',
    title: 'Ảnh sang AVIF',
    description: 'Xuất AVIF thế hệ mới, dung lượng rất nhỏ cho web hiện đại.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'image-to-pdf',
    title: 'Ảnh sang PDF',
    description: 'Đóng ảnh thành PDF gọn, đúng tỉ lệ, hợp gửi hồ sơ và in ấn.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'pdf-to-png',
    title: 'PDF sang PNG',
    description: 'Render từng trang PDF thành PNG sắc nét để preview, lưu trữ hoặc chỉnh sửa tiếp.',
    accept: '.pdf,application/pdf',
    badge: 'Image'
  },
  {
    id: 'compress-image',
    title: 'Nén ảnh',
    description: 'Giảm dung lượng ảnh lớn, giới hạn cạnh dài 2560px và xuất JPEG tối ưu.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'resize-image',
    title: 'Resize ảnh web',
    description: 'Resize cạnh dài về 1920px, xuất WebP cân bằng chất lượng và dung lượng.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'upscale-image',
    title: 'Upscale 2x',
    description: 'Phóng ảnh 2x bằng Lanczos + làm nét nhẹ, hợp ảnh nhỏ cần rõ hơn.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'square-thumbnail',
    title: 'Thumbnail vuông',
    description: 'Tạo ảnh vuông 1200x1200 WebP nền trắng, hợp avatar, shop, mạng xã hội.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'strip-metadata',
    title: 'Xóa metadata',
    description: 'Loại EXIF/metadata nhạy cảm, giữ ảnh sạch hơn trước khi chia sẻ.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'image-metadata',
    title: 'Đọc metadata',
    description: 'Xuất thông tin kỹ thuật ảnh thành JSON: kích thước, format, màu, density.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'scan-document',
    title: 'Scan tài liệu',
    description: 'Làm sạch ảnh chụp giấy tờ: xoay theo metadata, xám hóa, tăng tương phản, làm nét và xuất PNG.',
    accept: 'image/*',
    badge: 'Scan'
  }
];

const toolGroups = [
  {
    id: 'documents' as FileGroupId,
    title: 'Tài liệu',
    description: 'PDF và Word cho biểu mẫu, hợp đồng, giấy tờ hành chính.',
    tools: fileTools.filter((tool) => tool.badge === 'Docs')
  },
  {
    id: 'data' as FileGroupId,
    title: 'Dữ liệu',
    description: 'Excel, CSV, JSON, XML cho import/export hệ thống.',
    tools: fileTools.filter((tool) => ['Data', 'XML', 'CSV'].includes(tool.badge))
  },
  {
    id: 'images' as FileGroupId,
    title: 'Ảnh',
    description: 'Đổi định dạng, nén, resize và làm sạch ảnh scan.',
    tools: fileTools.filter((tool) => ['Image', 'Scan'].includes(tool.badge))
  }
];

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

function DownloadList({ files }: { files: ConvertFile[] }) {
  if (!files.length) return null;

  return (
    <div className="downloads">
      {files.map((file) => (
        <div className="download-item" key={file.downloadUrl}>
          <a className="download-name" href={file.downloadUrl} target="_blank" rel="noreferrer">
            <CheckCircle2 size={18} />
            <span>{file.fileName}</span>
          </a>
          <small>{formatBytes(file.size)}</small>
          <a className="download-action" href={file.downloadUrl} target="_blank" rel="noreferrer">Mở</a>
          <a className="download-action primary" href={file.downloadUrl} download={file.fileName}>Tải</a>
        </div>
      ))}
    </div>
  );
}

function previewKind(fileName: string) {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  if (['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (['json', 'xml', 'csv', 'txt'].includes(extension)) return 'text';
  return '';
}

function ResultPreview({ files }: { files: ConvertFile[] }) {
  const file = files.find((item) => previewKind(item.fileName));
  if (!file) return null;

  const kind = previewKind(file.fileName);

  return (
    <div className="preview-card">
      <div className="preview-head">
        <span>Preview</span>
        <strong>{file.fileName}</strong>
      </div>
      {kind === 'image' ? (
        <img src={file.downloadUrl} alt={file.fileName} />
      ) : (
        <iframe title={`Preview ${file.fileName}`} src={file.downloadUrl} />
      )}
    </div>
  );
}

export function App() {
  const [activeTool, setActiveTool] = useState<ActiveTool>('media');
  const [activeFileGroup, setActiveFileGroup] = useState<FileGroupId>('documents');
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
  const [selectedTool, setSelectedTool] = useState<FileToolId>('word-to-pdf');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMessage, setFileMessage] = useState('Chọn một tiện ích và upload file để bắt đầu.');
  const [fileError, setFileError] = useState(false);
  const [fileResults, setFileResults] = useState<ConvertFile[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const pollTimer = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const logs = useMemo(() => {
    const lines = job.error ? [...job.logs, job.error] : job.logs;
    return lines.length ? lines.join('\n') : 'Log sẽ xuất hiện tại đây.';
  }, [job]);

  const currentTool = fileTools.find((tool) => tool.id === selectedTool) || fileTools[0];
  const currentGroup = toolGroups.find((group) => group.id === activeFileGroup) || toolGroups[0];
  const isScanTool = currentTool.id === 'scan-document';

  function canUseTool(tool: FileTool) {
    if (tool.needsLibreOffice && !health?.libreOfficeReady) return false;
    if (tool.needsPdf2Docx && !health?.pdf2docxReady) return false;
    return true;
  }

  function toolDisabledReason(tool: FileTool) {
    if (tool.needsLibreOffice && !health?.libreOfficeReady) return 'Cần LibreOffice';
    if (tool.needsPdf2Docx && !health?.pdf2docxReady) return 'Cần pdf2docx';
    return '';
  }

  function fileMatchesTool(file: File, tool: FileTool) {
    const name = file.name.toLowerCase();
    return tool.accept
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .some((accepted) => accepted === 'image/*' ? file.type.startsWith('image/') : name.endsWith(accepted));
  }

  function selectUploadFile(file: File | null) {
    setSelectedFile(file);
    setFileResults([]);
    setFileError(false);

    if (file) {
      setFileMessage(`Đã chọn: ${file.name} (${formatBytes(file.size)})`);
    }
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function refreshCameraDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((device) => device.kind === 'videoinput');
    setCameraDevices(videoDevices);
    if (!selectedCameraId && videoDevices[0]?.deviceId) {
      setSelectedCameraId(videoDevices[0].deviceId);
    }
  }

  async function startCamera(deviceId = selectedCameraId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt này không hỗ trợ mở camera trực tiếp. Bạn vẫn có thể chọn ảnh từ máy.');
      return;
    }

    setCameraBusy(true);
    setCameraError('');
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });

      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      await refreshCameraDevices();
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Không mở được camera. Hãy kiểm tra quyền camera của trình duyệt.');
    } finally {
      setCameraBusy(false);
    }
  }

  function openCamera() {
    setCameraOpen(true);
    window.setTimeout(() => {
      startCamera();
    }, 0);
  }

  function closeCamera() {
    stopCamera();
    setCameraOpen(false);
    setCameraError('');
  }

  async function captureCameraFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera chưa sẵn sàng để chụp.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Không tạo được khung ảnh từ camera.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1));
    if (!blob) {
      setCameraError('Không xuất được ảnh chụp từ camera.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const capturedFile = new File([blob], `scan-camera-${timestamp}.png`, { type: 'image/png' });
    selectUploadFile(capturedFile);
    closeCamera();
    await runFileConversion(capturedFile, currentTool);
  }

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
      stopCamera();
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

  async function handleMediaSubmit(event: FormEvent) {
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

  async function handleFileSubmit(event: FormEvent) {
    event.preventDefault();
    await runFileConversion(selectedFile, currentTool);
  }

  async function runFileConversion(file: File | null, tool: FileTool) {
    if (!file) {
      setFileMessage('Bạn cần chọn file trước khi chuyển đổi.');
      setFileError(true);
      return;
    }

    if (!canUseTool(tool)) {
      setFileMessage(toolDisabledReason(tool) || 'Tool này chưa sẵn sàng trên môi trường hiện tại.');
      setFileError(true);
      return;
    }

    if (!fileMatchesTool(file, tool)) {
      setFileMessage(`File "${file.name}" không đúng định dạng cho ${tool.title}. Định dạng nhận: ${tool.accept}.`);
      setFileError(true);
      return;
    }

    setFileBusy(true);
    setFileResults([]);
    setFileError(false);
    setFileMessage(`Đang chạy ${tool.title}...`);

    try {
      const result = await convertFile(tool.id, file);
      setFileResults(result.files);
      setFileMessage(`Hoàn tất: ${result.input}`);
    } catch (error) {
      setFileMessage(error instanceof Error ? error.message : 'Không thể chuyển đổi file này.');
      setFileError(true);
    } finally {
      setFileBusy(false);
    }
  }

  const ready = Boolean(health?.ready);
  const healthMessage = ready
    ? `Node ${health?.nodeVersion}. LibreOffice: ${health?.libreOfficeReady ? 'có' : 'chưa có'}, pdf2docx: ${health?.pdf2docxReady ? 'có' : 'chưa có'}.`
    : healthError || health?.message || 'Đang đọc trạng thái công cụ...';

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Wand2 size={24} />
            </span>
            <span>Convert URL Studio</span>
          </div>
          <h1>Bộ chuyển đổi media, tài liệu và dữ liệu trong một giao diện.</h1>
          <p className="hero-copy">
            Chuyển URL sang MP4/MP3, Excel sang JSON/XML/CSV, JSON/XML/CSV sang Excel, Word sang PDF và PDF sang Word.
            Backend xử lý bằng Node, yt-dlp, ffmpeg, ExcelJS và LibreOffice khi có sẵn.
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

      <div className="tool-tabs" role="tablist" aria-label="Nhóm công cụ">
        <button type="button" className={activeTool === 'media' ? 'active' : ''} onClick={() => setActiveTool('media')}>
          <Link2 size={18} />
          Media URL
        </button>
        <button type="button" className={activeTool === 'files' ? 'active' : ''} onClick={() => setActiveTool('files')}>
          <FileSpreadsheet size={18} />
          File Tools
        </button>
      </div>

      {activeTool === 'media' ? (
        <section className="workspace">
          <form className="converter-panel" onSubmit={handleMediaSubmit}>
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

            <DownloadList files={job.files} />
            <ResultPreview files={job.files} />

            <div className={`log-box ${job.status === 'failed' ? 'error' : ''}`} ref={logRef}>
              {logs}
            </div>
          </aside>
        </section>
      ) : (
        <section className="workspace">
          <form className="converter-panel" onSubmit={handleFileSubmit}>
            <div className="file-workbench">
              <div className="group-rail" aria-label="Nhóm file tools">
                {toolGroups.map((group) => (
                  <button
                    type="button"
                    className={activeFileGroup === group.id ? 'active' : ''}
                    key={group.id}
                    onClick={() => {
                      setActiveFileGroup(group.id);
                      const firstTool = group.tools.find((tool) => canUseTool(tool)) || group.tools[0];
                      setSelectedTool(firstTool.id);
                      setSelectedFile(null);
                      setFileResults([]);
                      setFileError(false);
                      setFileMessage(toolDisabledReason(firstTool) || firstTool.description);
                    }}
                  >
                    <strong>{group.title}</strong>
                    <span>{group.tools.length} tools</span>
                  </button>
                ))}
              </div>

              <section className="tool-picker">
                <div className="tool-section-head">
                  <h3>{currentGroup.title}</h3>
                  <span>{currentGroup.description}</span>
                </div>

                <div className="tool-list">
                  {currentGroup.tools.map((tool) => {
                    const usable = canUseTool(tool);
                    const disabledReason = toolDisabledReason(tool);

                    return (
                      <button
                        className={`tool-row ${selectedTool === tool.id ? 'active' : ''}`}
                        type="button"
                        key={tool.id}
                        onClick={() => {
                          setSelectedTool(tool.id);
                          setSelectedFile(null);
                          setFileResults([]);
                          setFileError(false);
                          setFileMessage(disabledReason || tool.description);
                        }}
                        disabled={!usable}
                        title={disabledReason || tool.description}
                      >
                        <span className="tool-card-icon">
                          {tool.badge === 'Docs' ? <FileText size={20} /> : tool.badge === 'Image' || tool.badge === 'Scan' ? <Image size={20} /> : <Database size={20} />}
                        </span>
                        <span>
                          <strong>{tool.title}</strong>
                          <small>{disabledReason || tool.description}</small>
                        </span>
                        <em>{tool.badge}</em>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="field">
              <label htmlFor="fileInput">{isScanTool ? 'Ảnh tài liệu hoặc camera' : 'File đầu vào'}</label>
              <div
                className={`upload-zone ${isDraggingFile ? 'dragging' : ''} ${selectedFile ? 'has-file' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingFile(false);
                  selectUploadFile(event.dataTransfer.files?.[0] || null);
                }}
              >
                <input
                  ref={fileInputRef}
                  id="fileInput"
                  className="sr-only-file"
                  type="file"
                  accept={currentTool.accept}
                  capture={isScanTool ? 'environment' : undefined}
                  onChange={(event) => selectUploadFile(event.target.files?.[0] || null)}
                />
                <div className="upload-icon" aria-hidden="true">
                  {isScanTool ? <Camera size={24} /> : <UploadCloud size={24} />}
                </div>
                <div className="upload-copy">
                  <strong>{selectedFile ? selectedFile.name : isScanTool ? 'Chụp tài liệu hoặc chọn ảnh scan' : 'Kéo thả file vào đây'}</strong>
                  <span>{selectedFile ? formatBytes(selectedFile.size) : `Định dạng nhận: ${currentTool.accept}`}</span>
                </div>
                <div className="upload-actions">
                  <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                    <UploadCloud size={18} />
                    Chọn file
                  </button>
                  {isScanTool ? (
                    <button type="button" className="secondary-button camera" onClick={openCamera}>
                      <Camera size={18} />
                      Camera
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {currentTool.needsLibreOffice && !health?.libreOfficeReady ? (
              <div className="notice">
                <AlertTriangle size={20} />
                <span>Tool này cần LibreOffice. Render/Docker sẽ có sau khi deploy image mới; máy local cần cài LibreOffice nếu muốn chạy tại chỗ.</span>
              </div>
            ) : null}

            {currentTool.needsPdf2Docx && !health?.pdf2docxReady ? (
              <div className="notice">
                <AlertTriangle size={20} />
                <span>Tool này cần pdf2docx để dựng Word có thể chỉnh sửa. Cài local bằng python -m pip install pdf2docx.</span>
              </div>
            ) : null}

            <button className="primary-button" type="submit" disabled={fileBusy || !selectedFile || !canUseTool(currentTool)}>
              {fileBusy ? <Loader2 className="spin" size={21} /> : <Download size={21} />}
              {fileBusy ? 'Đang chuyển đổi...' : `Chạy ${currentTool.title}`}
            </button>
          </form>

          <aside className="status-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">File Tools</span>
                <h2>{currentTool.title}</h2>
              </div>
              <span className="job-badge completed">{currentTool.badge}</span>
            </div>

            <p className={`side-copy ${fileError ? 'error-text' : ''}`}>{fileMessage}</p>
            <DownloadList files={fileResults} />
            <ResultPreview files={fileResults} />

            <div className="capability-panel">
              <strong>Gợi ý mở rộng tiếp theo</strong>
              <span>Nén PDF, gộp/tách PDF, OCR scan sang searchable PDF, JSON validator, CSV cleaner và batch convert nhiều file.</span>
            </div>

            <div className={`ai-panel ${health?.openAIReady ? 'ready' : ''}`}>
              <span className="tool-card-icon" aria-hidden="true">
                <Sparkles size={20} />
              </span>
              <div>
                <strong>AI Image Studio</strong>
                <span>
                  {health?.openAIReady
                    ? 'OPENAI_API_KEY đã sẵn sàng. Có thể mở rộng tạo ảnh, sửa ảnh bằng prompt, xóa nền và nâng cấp ảnh bằng AI.'
                    : 'Chưa bật OPENAI_API_KEY. Khi thêm key, có thể gắn GPT Image cho tạo/sửa ảnh bằng prompt, cleanup scan và enhancement thông minh.'}
                </span>
              </div>
            </div>
          </aside>
        </section>
      )}

      {cameraOpen ? (
        <div className="camera-backdrop" role="dialog" aria-modal="true" aria-label="Chụp ảnh tài liệu">
          <div className="camera-modal">
            <div className="camera-head">
              <div>
                <span className="eyebrow">Scan tài liệu</span>
                <h2>Chụp ảnh từ camera</h2>
              </div>
              <button type="button" className="download-action" onClick={closeCamera}>Đóng</button>
            </div>

            <div className="camera-view">
              <video ref={videoRef} playsInline muted />
              <div className="scan-frame" aria-hidden="true" />
              {cameraBusy ? <span className="camera-loading">Đang mở camera...</span> : null}
            </div>

            {cameraDevices.length > 1 ? (
              <div className="field camera-device">
                <label htmlFor="cameraSelect">Camera</label>
                <select
                  id="cameraSelect"
                  value={selectedCameraId}
                  onChange={(event) => {
                    const nextDeviceId = event.target.value;
                    setSelectedCameraId(nextDeviceId);
                    startCamera(nextDeviceId);
                  }}
                >
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {cameraError ? (
              <div className="notice camera-notice">
                <AlertTriangle size={20} />
                <span>{cameraError}</span>
              </div>
            ) : null}

            <div className="camera-actions">
              <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                <UploadCloud size={18} />
                Chọn ảnh có sẵn
              </button>
              <button type="button" className="primary-button" onClick={captureCameraFrame} disabled={cameraBusy}>
                <Camera size={21} />
                Chụp ảnh
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
