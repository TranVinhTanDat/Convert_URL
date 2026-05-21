import {
  AlertTriangle,
  Archive,
  Camera,
  CheckCircle2,
  Clipboard,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Image,
  Link2,
  Loader2,
  Newspaper,
  PlayCircle,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
  XCircle
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  approveArticle,
  convertFiles,
  createJob,
  createNewsVideo,
  extractArticle,
  getHealth,
  getJob,
  getNewsFeed,
  getPreview,
  refreshNews,
  rejectArticle,
  zipUrl
} from './api';
import type {
  ConvertFile,
  ConvertJob,
  CreateJobPayload,
  FileConversionItem,
  FileConversionResult,
  FileToolId,
  HealthResponse,
  NewsArticle,
  NewsVideoRequest,
  NewsVideoResult,
  OutputFormat,
  PreviewPayload,
  PreviewSheet
} from './types';

type ActiveTool = 'content' | 'media' | 'files';
type FileGroupId = 'documents' | 'data' | 'images';

interface FileTool {
  id: FileToolId;
  title: string;
  description: string;
  accept: string;
  badge: string;
  needsLibreOffice?: boolean;
  needsPdf2Docx?: boolean;
  needsRembg?: boolean;
  acceptsMulti?: boolean;
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
  },
  {
    id: 'remove-background',
    title: 'Xoá nền (AI)',
    description: 'Tách subject khỏi nền bằng U2Net/IS-Net, xuất PNG trong suốt. Dùng cho ảnh sản phẩm, chân dung.',
    accept: 'image/*',
    badge: 'AI',
    needsRembg: true
  },
  {
    id: 'chroma-key',
    title: 'Xoá màu nền (Chroma key)',
    description: 'Đổi 1 màu nền đặc (đen/trắng/xanh chroma…) thành trong suốt. Nhanh + chính xác cho logo, ảnh studio. Auto detect màu góc hoặc chọn HEX tuỳ ý.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'crop-image',
    title: 'Crop ảnh',
    description: 'Cắt theo tỉ lệ chuẩn (vuông, 16:9, 4:3, 3:2…) hoặc kích thước tuỳ chỉnh, giữ trung tâm hoặc chọn vị trí.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'rotate-image',
    title: 'Xoay & lật ảnh',
    description: 'Xoay ảnh theo độ tuỳ ý (90/180/270…) và lật ngang/dọc. Lưu thành PNG để giữ chất lượng.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'filter-image',
    title: 'Bộ lọc ảnh',
    description: 'Grayscale, sepia, invert, blur, sharpen, brightness, cool, warm — preview live trong UI.',
    accept: 'image/*',
    badge: 'Image'
  },
  {
    id: 'merge-pdf',
    title: 'Gộp PDF',
    description: 'Gộp nhiều file PDF thành 1 file duy nhất theo đúng thứ tự upload.',
    accept: '.pdf,application/pdf',
    badge: 'Docs',
    acceptsMulti: true
  },
  {
    id: 'split-pdf',
    title: 'Tách PDF',
    description: 'Tách từng trang ra file riêng, hoặc chọn dải trang (vd: 1-3, 5, 8-10).',
    accept: '.pdf,application/pdf',
    badge: 'Docs'
  }
];

type OptionField =
  | { type: 'range'; key: string; label: string; help?: string; min: number; max: number; step?: number; defaultValue: number; suffix?: string }
  | { type: 'number'; key: string; label: string; help?: string; min: number; max: number; step?: number; defaultValue: number; suffix?: string }
  | { type: 'select'; key: string; label: string; help?: string; options: Array<{ value: string; label: string }>; defaultValue: string }
  | { type: 'color'; key: string; label: string; help?: string; defaultValue: string }
  | { type: 'text'; key: string; label: string; help?: string; placeholder?: string; defaultValue: string };

const toolOptionSpec: Partial<Record<FileToolId, OptionField[]>> = {
  'image-to-jpeg': [
    { type: 'range', key: 'quality', label: 'Chất lượng', help: 'Cao = ảnh đẹp + file lớn', min: 50, max: 100, defaultValue: 88, suffix: '%' }
  ],
  'image-to-webp': [
    { type: 'range', key: 'quality', label: 'Chất lượng', min: 40, max: 100, defaultValue: 86, suffix: '%' },
    { type: 'range', key: 'effort', label: 'Mức nén', help: '0 nhanh, 6 nhỏ nhất', min: 0, max: 6, defaultValue: 5 }
  ],
  'image-to-avif': [
    { type: 'range', key: 'quality', label: 'Chất lượng', min: 30, max: 90, defaultValue: 62, suffix: '%' },
    { type: 'range', key: 'effort', label: 'Mức nén', help: '0 nhanh, 9 nhỏ nhất', min: 0, max: 9, defaultValue: 7 }
  ],
  'image-to-png': [
    { type: 'range', key: 'compression', label: 'Mức nén', help: '0 nhanh, 9 nhỏ nhất', min: 0, max: 9, defaultValue: 9 }
  ],
  'compress-image': [
    { type: 'range', key: 'quality', label: 'JPEG quality', min: 50, max: 95, defaultValue: 78, suffix: '%' },
    { type: 'number', key: 'maxDimension', label: 'Cạnh dài tối đa', min: 600, max: 6000, step: 100, defaultValue: 2560, suffix: 'px' }
  ],
  'resize-image': [
    { type: 'number', key: 'width', label: 'Cạnh dài mục tiêu', min: 200, max: 6000, step: 100, defaultValue: 1920, suffix: 'px' },
    { type: 'range', key: 'quality', label: 'WebP quality', min: 40, max: 100, defaultValue: 84, suffix: '%' }
  ],
  'upscale-image': [
    {
      type: 'select',
      key: 'scale',
      label: 'Tỉ lệ phóng',
      defaultValue: '2x',
      options: [
        { value: '2x', label: '2x (mặc định)' },
        { value: '3x', label: '3x' },
        { value: '4x', label: '4x (giới hạn cạnh 6000px)' }
      ]
    }
  ],
  'square-thumbnail': [
    { type: 'number', key: 'size', label: 'Kích thước', min: 200, max: 2400, step: 50, defaultValue: 1200, suffix: 'px' },
    { type: 'color', key: 'background', label: 'Màu nền padding', defaultValue: '#ffffff' },
    { type: 'range', key: 'quality', label: 'WebP quality', min: 50, max: 100, defaultValue: 86, suffix: '%' }
  ],
  'pdf-to-png': [
    { type: 'number', key: 'width', label: 'Chiều rộng mỗi trang', min: 600, max: 3600, step: 100, defaultValue: 1800, suffix: 'px' }
  ],
  'remove-background': [
    {
      type: 'select',
      key: 'model',
      label: 'Mô hình AI',
      defaultValue: 'u2net',
      help: 'u2net cân bằng · isnet chuẩn nhất · isnet-anime cho ảnh vẽ',
      options: [
        { value: 'u2net', label: 'U2Net (mặc định, tổng quát)' },
        { value: 'u2netp', label: 'U2NetP (nhẹ, nhanh)' },
        { value: 'silueta', label: 'Silueta (chân dung)' },
        { value: 'isnet-general-use', label: 'IS-Net General (chất lượng cao)' },
        { value: 'isnet-anime', label: 'IS-Net Anime (ảnh vẽ)' }
      ]
    }
  ],
  'chroma-key': [
    {
      type: 'select',
      key: 'target',
      label: 'Chọn màu nền',
      defaultValue: 'auto',
      help: 'Auto = lấy màu trung bình 4 góc ảnh (chuẩn cho logo)',
      options: [
        { value: 'auto', label: 'Auto detect 4 góc' },
        { value: 'custom', label: 'Tự nhập HEX' }
      ]
    },
    { type: 'color', key: 'color', label: 'HEX màu nền (chỉ khi Custom)', defaultValue: '#000000' },
    {
      type: 'range',
      key: 'tolerance',
      label: 'Dung sai màu',
      help: 'Cao = ăn sâu vào subject, thấp = sót viền',
      min: 0,
      max: 120,
      defaultValue: 32
    },
    {
      type: 'range',
      key: 'feather',
      label: 'Mềm cạnh (feather)',
      help: 'Tạo gradient alpha quanh viền, tránh răng cưa',
      min: 0,
      max: 60,
      defaultValue: 12
    }
  ],
  'crop-image': [
    {
      type: 'select',
      key: 'aspect',
      label: 'Tỉ lệ crop',
      defaultValue: 'square',
      options: [
        { value: 'square', label: 'Vuông (1:1)' },
        { value: '4:3', label: '4:3 (chuẩn)' },
        { value: '3:2', label: '3:2 (DSLR)' },
        { value: '16:9', label: '16:9 (widescreen)' },
        { value: '9:16', label: '9:16 (story/reel)' },
        { value: '3:4', label: '3:4 (portrait)' },
        { value: '2:3', label: '2:3 (portrait)' },
        { value: 'custom', label: 'Tuỳ chỉnh (width × height + x, y)' }
      ]
    },
    { type: 'number', key: 'width', label: 'Width (chỉ dùng khi Custom)', min: 1, max: 10000, step: 10, defaultValue: 1000, suffix: 'px' },
    { type: 'number', key: 'height', label: 'Height (chỉ dùng khi Custom)', min: 1, max: 10000, step: 10, defaultValue: 1000, suffix: 'px' },
    { type: 'number', key: 'x', label: 'Vị trí X (top-left)', min: 0, max: 10000, step: 10, defaultValue: 0, suffix: 'px' },
    { type: 'number', key: 'y', label: 'Vị trí Y (top-left)', min: 0, max: 10000, step: 10, defaultValue: 0, suffix: 'px' }
  ],
  'rotate-image': [
    {
      type: 'select',
      key: 'rotate',
      label: 'Góc xoay',
      defaultValue: '90',
      options: [
        { value: '0', label: '0° (chỉ flip)' },
        { value: '90', label: '90° clockwise' },
        { value: '180', label: '180°' },
        { value: '270', label: '270° (= -90°)' },
        { value: '45', label: '45° (góc tự do)' },
        { value: '-45', label: '-45°' }
      ]
    },
    {
      type: 'select',
      key: 'flipH',
      label: 'Lật ngang (mirror)',
      defaultValue: 'false',
      options: [{ value: 'false', label: 'Không' }, { value: 'true', label: 'Có' }]
    },
    {
      type: 'select',
      key: 'flipV',
      label: 'Lật dọc',
      defaultValue: 'false',
      options: [{ value: 'false', label: 'Không' }, { value: 'true', label: 'Có' }]
    },
    { type: 'color', key: 'background', label: 'Nền góc (sau xoay)', defaultValue: '#ffffff' }
  ],
  'filter-image': [
    {
      type: 'select',
      key: 'filter',
      label: 'Hiệu ứng',
      defaultValue: 'grayscale',
      options: [
        { value: 'grayscale', label: 'Đen trắng' },
        { value: 'sepia', label: 'Sepia (cổ điển)' },
        { value: 'invert', label: 'Đảo màu (negative)' },
        { value: 'blur', label: 'Làm mờ' },
        { value: 'sharpen', label: 'Làm nét' },
        { value: 'brightness', label: 'Tăng/giảm sáng' },
        { value: 'cool', label: 'Cool (xanh dương)' },
        { value: 'warm', label: 'Warm (cam ấm)' }
      ]
    },
    { type: 'range', key: 'intensity', label: 'Cường độ', min: 0.1, max: 3, step: 0.1, defaultValue: 1 }
  ],
  'split-pdf': [
    {
      type: 'select',
      key: 'mode',
      label: 'Cách tách',
      defaultValue: 'pages',
      options: [
        { value: 'pages', label: 'Mỗi trang 1 file PDF' },
        { value: 'ranges', label: 'Theo dải trang (specify ranges)' }
      ]
    },
    {
      type: 'text',
      key: 'ranges',
      label: 'Dải trang (chỉ dùng khi chọn Ranges)',
      placeholder: '1-3, 5, 8-10',
      defaultValue: '',
      help: 'Phân cách bằng dấu phẩy. Bỏ trống = tách hết.'
    }
  ]
};

function defaultsForTool(tool: FileToolId): Record<string, string | number> {
  const spec = toolOptionSpec[tool];
  if (!spec) return {};
  const result: Record<string, string | number> = {};
  for (const field of spec) result[field.key] = field.defaultValue;
  return result;
}

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
    description: 'Đổi định dạng, biến đổi, AI xoá nền, lọc và làm sạch ảnh.',
    tools: fileTools.filter((tool) => ['Image', 'Scan', 'AI'].includes(tool.badge))
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

function DownloadList({ files, compact = false }: { files: ConvertFile[]; compact?: boolean }) {
  if (!files.length) return null;

  return (
    <div className={`downloads ${compact ? 'compact' : ''}`}>
      {files.map((file) => (
        <div className="download-item" key={file.downloadUrl}>
          <a className="download-name" href={file.downloadUrl} target="_blank" rel="noreferrer" title={file.fileName}>
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

type PreviewKind = 'image' | 'pdf' | 'text' | 'table' | '';

function previewKind(fileName: string): PreviewKind {
  const extension = fileExtension(fileName);
  if (['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'xlsx') return 'table';
  if (['json', 'xml', 'csv', 'txt'].includes(extension)) return 'text';
  return '';
}

function fileExtension(fileName: string) {
  return fileName.toLowerCase().split('.').pop() || '';
}

const PREVIEW_LIMIT = 200_000;

function PreviewTable({ sheet }: { sheet: PreviewSheet }) {
  const { headers, rows, totalRows } = sheet;
  if (!headers.length) {
    return <div className="preview-empty">Sheet này chưa có cột nào.</div>;
  }
  return (
    <div className="preview-table-wrap">
      <div className="preview-table-meta">
        <span><strong>{sheet.name}</strong></span>
        <span>{headers.length} cột · hiển thị {rows.length.toLocaleString('vi-VN')}/{totalRows.toLocaleString('vi-VN')} dòng</span>
      </div>
      <div className="preview-scroll">
        <table className="preview-table">
          <thead>
            <tr>
              <th className="row-index">#</th>
              {headers.map((cell, idx) => <th key={idx} title={cell}>{cell}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr key={rIdx}>
                <td className="row-index">{rIdx + 1}</td>
                {headers.map((_, cIdx) => (
                  <td key={cIdx} title={row[cIdx] || ''}>{row[cIdx] || ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultPreview({ files }: { files: ConvertFile[] }) {
  const file = files.find((item) => previewKind(item.fileName));
  const kind = file ? previewKind(file.fileName) : '';
  const extension = file ? fileExtension(file.fileName) : '';
  const [text, setText] = useState('');
  const [textError, setTextError] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    if (!file || kind !== 'text') {
      setText('');
      setTextError('');
      return;
    }
    let aborted = false;
    setLoadingText(true);
    setTextError('');
    fetch(file.downloadUrl)
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((body) => {
        if (aborted) return;
        const truncated = body.length > PREVIEW_LIMIT
          ? `${body.slice(0, PREVIEW_LIMIT)}\n\n... (đã rút gọn ${(body.length - PREVIEW_LIMIT).toLocaleString('vi-VN')} ký tự để xem nhanh, tải file để xem đầy đủ)`
          : body;
        setText(truncated);
        setLoadingText(false);
      })
      .catch((error: Error) => {
        if (aborted) return;
        setTextError(error.message || 'Không tải được nội dung preview.');
        setLoadingText(false);
      });
    return () => { aborted = true; };
  }, [file?.downloadUrl, kind]);

  useEffect(() => {
    if (!file || (kind !== 'table' && !(kind === 'text' && (extension === 'csv' || extension === 'json')))) {
      setPreview(null);
      setPreviewError('');
      return;
    }
    let aborted = false;
    setPreview(null);
    setPreviewError('');
    setActiveSheet(0);
    getPreview(file.downloadUrl)
      .then((data) => {
        if (aborted) return;
        setPreview(data);
      })
      .catch((error: Error) => {
        if (aborted) return;
        setPreviewError(error.message || 'Không tải được preview.');
      });
    return () => { aborted = true; };
  }, [file?.downloadUrl, kind, extension]);

  if (!file) return null;

  const workbook = preview && preview.kind === 'workbook' ? preview : null;
  const activeSheetData = workbook?.sheets[Math.min(activeSheet, workbook.sheets.length - 1)] ?? null;

  return (
    <div className={`preview-card preview-${kind || 'generic'}`}>
      <div className="preview-head">
        <span>Preview · {extension.toUpperCase() || 'FILE'}</span>
        <strong title={file.fileName}>{file.fileName}</strong>
      </div>
      {kind === 'image' ? (
        <img src={file.downloadUrl} alt={file.fileName} />
      ) : kind === 'pdf' ? (
        <iframe title={`Preview ${file.fileName}`} src={file.downloadUrl} />
      ) : kind === 'table' ? (
        previewError ? (
          <pre className="preview-text error">{previewError}</pre>
        ) : !workbook ? (
          <div className="preview-loading"><Loader2 className="spin" size={18} /> Đang tải bảng tính...</div>
        ) : workbook.sheets.length === 0 ? (
          <div className="preview-empty">Workbook không có sheet.</div>
        ) : (
          <>
            {workbook.sheets.length > 1 ? (
              <div className="sheet-tabs" role="tablist">
                {workbook.sheets.map((sheet, idx) => (
                  <button
                    key={idx}
                    type="button"
                    role="tab"
                    className={activeSheet === idx ? 'active' : ''}
                    onClick={() => setActiveSheet(idx)}
                  >
                    {sheet.name}
                    <em>{sheet.totalRows}</em>
                  </button>
                ))}
              </div>
            ) : null}
            {activeSheetData ? <PreviewTable sheet={activeSheetData} /> : null}
          </>
        )
      ) : kind === 'text' && (extension === 'csv' || extension === 'json') && workbook ? (
        workbook.sheets.length > 1 ? (
          <>
            <div className="sheet-tabs">
              {workbook.sheets.map((sheet, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={activeSheet === idx ? 'active' : ''}
                  onClick={() => setActiveSheet(idx)}
                >
                  {sheet.name}
                  <em>{sheet.totalRows}</em>
                </button>
              ))}
            </div>
            {activeSheetData ? <PreviewTable sheet={activeSheetData} /> : null}
          </>
        ) : workbook.sheets[0] ? (
          <PreviewTable sheet={workbook.sheets[0]} />
        ) : (
          <pre className={`preview-text lang-${extension}`}>{text}</pre>
        )
      ) : kind === 'text' ? (
        loadingText
          ? <div className="preview-loading"><Loader2 className="spin" size={18} /> Đang tải nội dung...</div>
          : textError
            ? <pre className="preview-text error">{textError}</pre>
            : <pre className={`preview-text lang-${extension}`}>{text}</pre>
      ) : null}
    </div>
  );
}

function DownloadGroups({ items, fallback }: { items?: FileConversionItem[]; fallback: ConvertFile[] }) {
  if (items && items.length > 1) {
    return (
      <div className="download-groups">
        {items.map((item, idx) => (
          <div key={`${item.input}-${idx}`} className={`download-group ${item.error ? 'has-error' : ''}`}>
            <div className="download-group-head">
              <strong title={item.input}>{item.input}</strong>
              {item.error ? <span className="badge danger">Lỗi</span> : <span className="badge ok">{item.files?.length || 0} file</span>}
            </div>
            {item.error ? (
              <div className="download-group-error"><AlertTriangle size={14} /> {item.error}</div>
            ) : (
              <DownloadList files={item.files || []} compact />
            )}
          </div>
        ))}
      </div>
    );
  }
  return <DownloadList files={fallback} />;
}

interface ToolOptionsPanelProps {
  tool: FileToolId;
  values: Record<string, string | number>;
  onChange: (key: string, value: string | number) => void;
  onReset: () => void;
}

function ToolOptionsPanel({ tool, values, onChange, onReset }: ToolOptionsPanelProps) {
  const spec = toolOptionSpec[tool];
  if (!spec || !spec.length) return null;

  const isDirty = spec.some((field) => values[field.key] !== field.defaultValue);

  return (
    <details className="options-panel" open>
      <summary>
        <Settings2 size={16} />
        <span>Tuỳ chọn nâng cao</span>
        {isDirty ? <em className="options-dot" aria-label="Đã chỉnh"></em> : null}
        <button type="button" className="options-reset" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onReset(); }} disabled={!isDirty}>
          Mặc định
        </button>
      </summary>
      <div className="options-body">
        {spec.map((field) => {
          if (field.type === 'range' || field.type === 'number') {
            const value = Number(values[field.key] ?? field.defaultValue);
            const fillPct = field.type === 'range'
              ? Math.round(((value - field.min) / Math.max(1, field.max - field.min)) * 100)
              : 0;
            return (
              <label key={field.key} className="option-row">
                <div className="option-head">
                  <span>{field.label}</span>
                  <strong>{value.toLocaleString('vi-VN')}{field.suffix || ''}</strong>
                </div>
                <input
                  type={field.type === 'range' ? 'range' : 'number'}
                  min={field.min}
                  max={field.max}
                  step={field.step || 1}
                  value={value}
                  onChange={(event) => onChange(field.key, Number(event.target.value))}
                  style={field.type === 'range' ? { ['--range-fill' as string]: `${fillPct}%` } : undefined}
                />
                {field.help ? <small>{field.help}</small> : null}
              </label>
            );
          }
          if (field.type === 'select') {
            const value = String(values[field.key] ?? field.defaultValue);
            return (
              <label key={field.key} className="option-row">
                <div className="option-head"><span>{field.label}</span></div>
                <select value={value} onChange={(event) => onChange(field.key, event.target.value)}>
                  {field.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                {field.help ? <small>{field.help}</small> : null}
              </label>
            );
          }
          if (field.type === 'color') {
            const value = String(values[field.key] ?? field.defaultValue);
            return (
              <label key={field.key} className="option-row option-color">
                <div className="option-head">
                  <span>{field.label}</span>
                  <strong>{value.toUpperCase()}</strong>
                </div>
                <div className="color-input-wrap">
                  <input type="color" value={value} onChange={(event) => onChange(field.key, event.target.value)} />
                  <input
                    type="text"
                    value={value}
                    onChange={(event) => onChange(field.key, event.target.value)}
                    placeholder="#ffffff"
                    spellCheck={false}
                  />
                </div>
                {field.help ? <small>{field.help}</small> : null}
              </label>
            );
          }
          if (field.type === 'text') {
            const value = String(values[field.key] ?? field.defaultValue);
            return (
              <label key={field.key} className="option-row">
                <div className="option-head"><span>{field.label}</span></div>
                <input
                  type="text"
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  spellCheck={false}
                />
                {field.help ? <small>{field.help}</small> : null}
              </label>
            );
          }
          return null;
        })}
      </div>
    </details>
  );
}

interface ToastMessage {
  id: number;
  variant: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.variant}`}>
          <span className="toast-icon" aria-hidden="true">
            {toast.variant === 'success' ? <CheckCircle2 size={18} /> : toast.variant === 'error' ? <XCircle size={18} /> : <Sparkles size={18} />}
          </span>
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.detail ? <span>{toast.detail}</span> : null}
          </div>
          <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Đóng">
            <XCircle size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

interface RecentEntry {
  jobId: string;
  tool: FileToolId;
  toolTitle: string;
  inputs: string[];
  files: ConvertFile[];
  createdAt: number;
}

const RECENT_LIMIT = 12;
const RECENT_STORAGE_KEY = 'convert-url:recent-v1';

function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(entries: RecentEntry[]) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries.slice(0, RECENT_LIMIT)));
  } catch {
    // localStorage may be full or disabled — silent
  }
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}

function RecentJobsPanel({ entries, onPick, onClear }: { entries: RecentEntry[]; onPick: (entry: RecentEntry) => void; onClear: () => void }) {
  if (!entries.length) return null;
  return (
    <details className="recent-panel" open>
      <summary>
        <History size={16} />
        <span>Lịch sử gần đây</span>
        <em>{entries.length}</em>
        <button
          type="button"
          className="recent-clear"
          aria-label="Xoá lịch sử"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClear(); }}
        >
          <Trash2 size={14} />
        </button>
      </summary>
      <ul className="recent-list">
        {entries.map((entry) => (
          <li key={entry.jobId}>
            <button type="button" className="recent-item" onClick={() => onPick(entry)}>
              <div className="recent-item-head">
                <strong>{entry.toolTitle}</strong>
                <small><Clock size={11} /> {relativeTime(entry.createdAt)}</small>
              </div>
              <span className="recent-item-files">
                {entry.inputs.length === 1
                  ? entry.inputs[0]
                  : `${entry.inputs.length} input → ${entry.files.length} output`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function App() {
  const [activeTool, setActiveTool] = useState<ActiveTool>('content');
  const [activeFileGroup, setActiveFileGroup] = useState<FileGroupId>('documents');
  const [newsUrl, setNewsUrl] = useState('');
  const [newsFormat, setNewsFormat] = useState<NewsVideoRequest['format']>('short');
  const [newsTone, setNewsTone] = useState<NewsVideoRequest['tone']>('newsroom');
  const [newsAutoPublish, setNewsAutoPublish] = useState(false);
  const [newsBusy, setNewsBusy] = useState(false);
  const [newsMessage, setNewsMessage] = useState('Nhập URL bài báo uy tín để tạo video nháp kèm storyboard, script và trạng thái duyệt.');
  const [newsError, setNewsError] = useState(false);
  const [newsResult, setNewsResult] = useState<NewsVideoResult | null>(null);
  const [feedArticles, setFeedArticles] = useState<NewsArticle[]>([]);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedLastRefresh, setFeedLastRefresh] = useState<string | null>(null);
  const [feedCategory, setFeedCategory] = useState<string>('all');
  const [feedStatusFilter, setFeedStatusFilter] = useState<'all' | 'pending' | 'approved'>('pending');
  const feedPollRef = useRef<number | null>(null);
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMessage, setFileMessage] = useState('Chọn một tiện ích và upload file để bắt đầu.');
  const [fileError, setFileError] = useState(false);
  const [fileResults, setFileResults] = useState<ConvertFile[]>([]);
  const [fileItems, setFileItems] = useState<FileConversionItem[]>([]);
  const [fileJobId, setFileJobId] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [optionValues, setOptionValues] = useState<Record<string, string | number>>(() => defaultsForTool('word-to-pdf'));
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
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

  const visibleTools = useMemo(() => {
    const term = toolSearch.trim().toLowerCase();
    if (!term) return currentGroup.tools;
    return currentGroup.tools.filter((tool) =>
      tool.title.toLowerCase().includes(term) ||
      tool.description.toLowerCase().includes(term) ||
      tool.badge.toLowerCase().includes(term) ||
      tool.id.toLowerCase().includes(term));
  }, [currentGroup.tools, toolSearch]);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    const ttl = toast.variant === 'error' ? 7000 : 4500;
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), ttl);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const loadFeed = useCallback(async (silent = false) => {
    try {
      const data = await getNewsFeed();
      setFeedArticles(data.articles);
      setFeedLastRefresh(data.lastRefreshAt);
    } catch (error) {
      if (!silent) {
        pushToast({
          variant: 'error',
          title: 'Không tải được news feed',
          detail: error instanceof Error ? error.message : undefined
        });
      }
    }
  }, [pushToast]);

  const refreshFeed = useCallback(async () => {
    if (feedRefreshing) return;
    setFeedRefreshing(true);
    try {
      const summary = await refreshNews();
      setFeedLastRefresh(summary.lastRefreshAt);
      await loadFeed(true);
      pushToast({
        variant: 'success',
        title: 'Đã làm mới VnExpress',
        detail: `+${summary.added} bài mới, cập nhật ${summary.updated} bài cũ`
      });
    } catch (error) {
      pushToast({
        variant: 'error',
        title: 'Refresh thất bại',
        detail: error instanceof Error ? error.message : undefined
      });
    } finally {
      setFeedRefreshing(false);
    }
  }, [feedRefreshing, loadFeed, pushToast]);

  useEffect(() => {
    if (activeTool !== 'content') {
      if (feedPollRef.current) window.clearInterval(feedPollRef.current);
      feedPollRef.current = null;
      return;
    }
    void loadFeed(false);
    feedPollRef.current = window.setInterval(() => { void loadFeed(true); }, 30_000);
    return () => {
      if (feedPollRef.current) window.clearInterval(feedPollRef.current);
      feedPollRef.current = null;
    };
  }, [activeTool, loadFeed]);

  async function handleArticleAction(article: NewsArticle, action: 'use' | 'extract' | 'approve' | 'reject') {
    if (action === 'use') {
      setNewsUrl(article.sourceUrl);
      pushToast({ variant: 'info', title: 'Đã đổ URL vào form', detail: article.title.slice(0, 80) });
      return;
    }
    try {
      const fn = action === 'extract' ? extractArticle : action === 'approve' ? approveArticle : rejectArticle;
      const updated = await fn(article.id);
      setFeedArticles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      const label = action === 'extract' ? 'Đã trích xuất' : action === 'approve' ? 'Đã duyệt' : 'Đã bỏ';
      pushToast({ variant: action === 'reject' ? 'info' : 'success', title: label, detail: updated.title.slice(0, 80) });
    } catch (error) {
      pushToast({
        variant: 'error',
        title: `${action === 'extract' ? 'Trích xuất' : action === 'approve' ? 'Duyệt' : 'Bỏ'} thất bại`,
        detail: error instanceof Error ? error.message : undefined
      });
    }
  }

  const visibleFeedArticles = useMemo(() => {
    return feedArticles.filter((article) => {
      if (feedStatusFilter === 'approved' && article.status !== 'approved') return false;
      if (feedStatusFilter === 'pending' && (article.status === 'approved' || article.status === 'rejected')) return false;
      if (feedCategory !== 'all' && (article.category || '') !== feedCategory) return false;
      return true;
    });
  }, [feedArticles, feedCategory, feedStatusFilter]);

  const feedCategories = useMemo(() => {
    const set = new Set<string>();
    for (const article of feedArticles) {
      if (article.category) set.add(article.category);
    }
    return Array.from(set).sort();
  }, [feedArticles]);

  const feedStats = useMemo(() => {
    const result = { total: feedArticles.length, scriptReady: 0, approved: 0, pending: 0, failed: 0 };
    for (const article of feedArticles) {
      if (article.status === 'approved') result.approved += 1;
      else if (article.status === 'rejected') {}
      else if (article.status === 'extract_failed') result.failed += 1;
      else result.pending += 1;
      if (article.status === 'script_ready') result.scriptReady += 1;
    }
    return result;
  }, [feedArticles]);

  useEffect(() => {
    setRecentEntries(loadRecent());
  }, []);

  useEffect(() => {
    setOptionValues(defaultsForTool(selectedTool));
  }, [selectedTool]);

  function setOptionValue(key: string, value: string | number) {
    setOptionValues((current) => ({ ...current, [key]: value }));
  }

  function resetOptions() {
    setOptionValues(defaultsForTool(selectedTool));
  }

  function persistRecent(result: FileConversionResult, toolTitle: string) {
    if (!result.files.length) return;
    const entry: RecentEntry = {
      jobId: result.id,
      tool: result.tool,
      toolTitle,
      inputs: (result.items || []).map((item) => item.input).filter(Boolean),
      files: result.files,
      createdAt: Date.now()
    };
    setRecentEntries((current) => {
      const next = [entry, ...current.filter((item) => item.jobId !== entry.jobId)].slice(0, RECENT_LIMIT);
      saveRecent(next);
      return next;
    });
  }

  function clearRecent() {
    setRecentEntries([]);
    saveRecent([]);
  }

  function applyRecent(entry: RecentEntry) {
    const tool = fileTools.find((item) => item.id === entry.tool);
    if (tool) {
      const groupHasTool = toolGroups.find((group) => group.tools.some((t) => t.id === tool.id));
      if (groupHasTool) setActiveFileGroup(groupHasTool.id);
      setSelectedTool(tool.id);
    }
    setFileResults(entry.files);
    setFileItems(entry.inputs.map((input, index) => ({ input, files: index === 0 ? entry.files : [] })));
    setFileJobId(entry.jobId);
    setFileMessage(`Đã mở lại: ${entry.toolTitle}`);
    setFileError(false);
    pushToast({ variant: 'info', title: 'Mở lại từ lịch sử', detail: entry.toolTitle });
  }

  function canUseTool(tool: FileTool) {
    if (tool.needsLibreOffice && !health?.libreOfficeReady) return false;
    if (tool.needsPdf2Docx && !health?.pdf2docxReady) return false;
    if (tool.needsRembg && !health?.rembgReady) return false;
    return true;
  }

  function toolDisabledReason(tool: FileTool) {
    if (tool.needsLibreOffice && !health?.libreOfficeReady) return 'Cần LibreOffice';
    if (tool.needsPdf2Docx && !health?.pdf2docxReady) return 'Cần pdf2docx';
    if (tool.needsRembg && !health?.rembgReady) return 'Cần rembg';
    return '';
  }

  function fileMatchesTool(file: File, tool: FileTool) {
    const name = file.name.toLowerCase();
    return tool.accept
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .some((accepted) => accepted === 'image/*' ? file.type.startsWith('image/') : name.endsWith(accepted));
  }

  function selectUploadFiles(input: File | File[] | FileList | null, mode: 'replace' | 'append' = 'replace') {
    const incoming: File[] = !input
      ? []
      : input instanceof File
        ? [input]
        : Array.from(input as File[] | FileList);

    setFileResults([]);
    setFileItems([]);
    setFileError(false);

    setSelectedFiles((current) => {
      const base = mode === 'append' ? [...current] : [];
      const seen = new Set(base.map((file) => `${file.name}::${file.size}`));
      for (const file of incoming) {
        const key = `${file.name}::${file.size}`;
        if (!seen.has(key)) {
          base.push(file);
          seen.add(key);
        }
      }
      if (!base.length) {
        setFileMessage('Chọn một tiện ích và upload file để bắt đầu.');
      } else if (base.length === 1) {
        setFileMessage(`Đã chọn: ${base[0].name} (${formatBytes(base[0].size)})`);
      } else {
        const totalBytes = base.reduce((sum, file) => sum + file.size, 0);
        setFileMessage(`Đã chọn ${base.length} file (${formatBytes(totalBytes)})`);
      }
      return base;
    });
  }

  function removeUploadFile(index: number) {
    setSelectedFiles((current) => {
      const next = current.filter((_, i) => i !== index);
      if (!next.length) {
        setFileMessage('Chọn một tiện ích và upload file để bắt đầu.');
      } else if (next.length === 1) {
        setFileMessage(`Đã chọn: ${next[0].name} (${formatBytes(next[0].size)})`);
      } else {
        const totalBytes = next.reduce((sum, file) => sum + file.size, 0);
        setFileMessage(`Đã chọn ${next.length} file (${formatBytes(totalBytes)})`);
      }
      return next;
    });
    setFileResults([]);
    setFileItems([]);
    setFileError(false);
  }

  function clearUploadFiles() {
    selectUploadFiles(null);
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
    selectUploadFiles(capturedFile);
    closeCamera();
    await runFileConversion([capturedFile], currentTool);
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

  async function handleNewsSubmit(event: FormEvent) {
    event.preventDefault();
    setNewsBusy(true);
    setNewsError(false);
    setNewsResult(null);
    setNewsMessage('Đang lấy bài viết, kiểm tra metadata, tạo storyboard và render video draft...');

    try {
      const result = await createNewsVideo({
        url: newsUrl.trim(),
        format: newsFormat,
        language: 'vi',
        tone: newsTone,
        autoPublish: newsAutoPublish
      });
      setNewsResult(result);
      setNewsMessage(result.status === 'ready_for_auto_publish'
        ? 'Đã tạo video nháp và đưa vào hàng chờ auto publish giả lập. Cần cấu hình token YouTube/TikTok/Sheet trước khi đăng thật.'
        : 'Đã tạo video nháp. Hãy kiểm tra nguồn, quyền ảnh và nội dung trước khi phê duyệt.');
      pushToast({ variant: 'success', title: 'Đã tạo News Video Draft', detail: result.article.title });
    } catch (error) {
      setNewsError(true);
      setNewsMessage(error instanceof Error ? error.message : 'Không tạo được video từ bài báo này.');
      pushToast({ variant: 'error', title: 'News Studio thất bại', detail: error instanceof Error ? error.message : undefined });
    } finally {
      setNewsBusy(false);
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
    await runFileConversion(selectedFiles, currentTool);
  }

  async function runFileConversion(files: File[], tool: FileTool) {
    if (!files.length) {
      setFileMessage('Bạn cần chọn ít nhất một file trước khi chuyển đổi.');
      setFileError(true);
      return;
    }

    if (!canUseTool(tool)) {
      setFileMessage(toolDisabledReason(tool) || 'Tool này chưa sẵn sàng trên môi trường hiện tại.');
      setFileError(true);
      return;
    }

    const invalid = files.find((file) => !fileMatchesTool(file, tool));
    if (invalid) {
      setFileMessage(`File "${invalid.name}" không đúng định dạng cho ${tool.title}. Định dạng nhận: ${tool.accept}.`);
      setFileError(true);
      return;
    }

    setFileBusy(true);
    setFileResults([]);
    setFileItems([]);
    setFileJobId('');
    setFileError(false);
    setFileMessage(files.length === 1
      ? `Đang chạy ${tool.title}...`
      : `Đang chạy ${tool.title} cho ${files.length} file...`);

    const startedAt = Date.now();
    try {
      const result = await convertFiles(tool.id, files, optionValues);
      setFileResults(result.files);
      setFileItems(result.items || []);
      setFileJobId(result.id);
      const successCount = (result.items || []).filter((item) => !item.error).length;
      const failCount = (result.items || []).filter((item) => item.error).length;
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (files.length === 1) {
        setFileMessage(`Hoàn tất: ${result.input}`);
        pushToast({ variant: 'success', title: `${tool.title} hoàn tất`, detail: `${result.input} · ${elapsed}s` });
      } else if (failCount === 0) {
        setFileMessage(`Hoàn tất ${successCount} file (${elapsed}s).`);
        pushToast({ variant: 'success', title: `${tool.title} hoàn tất`, detail: `${successCount} file · ${elapsed}s` });
      } else {
        setFileMessage(`Hoàn tất ${successCount}/${files.length} file (${failCount} lỗi · ${elapsed}s).`);
        setFileError(true);
        pushToast({ variant: 'error', title: `${tool.title} có lỗi`, detail: `${failCount}/${files.length} file lỗi` });
      }
      persistRecent(result, tool.title);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể chuyển đổi file này.';
      setFileMessage(message);
      setFileError(true);
      pushToast({ variant: 'error', title: `${tool.title} thất bại`, detail: message });
    } finally {
      setFileBusy(false);
    }
  }

  const ready = Boolean(health?.ready);
  const healthMessage = ready
    ? `Node ${health?.nodeVersion}. LibreOffice: ${health?.libreOfficeReady ? '✓' : '✗'} · pdf2docx: ${health?.pdf2docxReady ? '✓' : '✗'} · rembg: ${health?.rembgReady ? '✓' : '✗'}.`
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
          <h1>Bộ chuyển đổi media, tài liệu.</h1>
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
        <button type="button" className={activeTool === 'content' ? 'active' : ''} onClick={() => setActiveTool('content')}>
          <Newspaper size={18} />
          Content Studio
        </button>
        <button type="button" className={activeTool === 'media' ? 'active' : ''} onClick={() => setActiveTool('media')}>
          <Link2 size={18} />
          Media URL
        </button>
        <button type="button" className={activeTool === 'files' ? 'active' : ''} onClick={() => setActiveTool('files')}>
          <FileSpreadsheet size={18} />
          File Tools
        </button>
      </div>

      {activeTool === 'content' ? (
        <>
          <section className="news-feed-section converter-panel">
            <header className="news-feed-head">
              <div>
                <span className="eyebrow">Today's Feed · VnExpress</span>
                <h2>Tin nóng tự crawl, sẵn sàng dựng video</h2>
                <p>
                  {feedLastRefresh
                    ? `Cập nhật lần cuối ${relativeTime(Date.parse(feedLastRefresh))} · ${feedStats.total} bài`
                    : 'Chưa có dữ liệu — bấm "Refresh" để crawl lần đầu'}
                </p>
              </div>
              <div className="news-feed-actions">
                <div className="news-feed-stats">
                  <span><strong>{feedStats.total}</strong>tổng</span>
                  <span><strong>{feedStats.scriptReady}</strong>sẵn sàng</span>
                  <span className="ok"><strong>{feedStats.approved}</strong>đã duyệt</span>
                  {feedStats.failed ? <span className="danger"><strong>{feedStats.failed}</strong>lỗi</span> : null}
                </div>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={refreshFeed}
                  disabled={feedRefreshing}
                  aria-label="Làm mới feed"
                >
                  {feedRefreshing ? <Loader2 className="spin" size={16} /> : <Newspaper size={16} />}
                  {feedRefreshing ? 'Đang crawl...' : 'Refresh ngay'}
                </button>
              </div>
            </header>

            <div className="news-feed-filters">
              <div className="news-segment" role="tablist">
                {(['pending', 'approved', 'all'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={feedStatusFilter === key ? 'active' : ''}
                    onClick={() => setFeedStatusFilter(key)}
                  >
                    {key === 'pending' ? 'Chờ duyệt' : key === 'approved' ? 'Đã duyệt' : 'Tất cả'}
                  </button>
                ))}
              </div>
              <select
                className="news-cat-select"
                value={feedCategory}
                onChange={(event) => setFeedCategory(event.target.value)}
              >
                <option value="all">Mọi chuyên mục</option>
                {feedCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>

            {visibleFeedArticles.length === 0 ? (
              <div className="news-feed-empty">
                <Newspaper size={28} />
                <strong>{feedArticles.length ? 'Không có bài khớp bộ lọc.' : 'Chưa có bài nào.'}</strong>
                <span>{feedArticles.length ? 'Đổi filter ở trên hoặc Refresh ngay.' : 'Bấm "Refresh ngay" để bắt đầu crawl VnExpress.'}</span>
              </div>
            ) : (
              <div className="news-grid">
                {visibleFeedArticles.map((article) => (
                  <article key={article.id} className={`news-card status-${article.status}`}>
                    <div className="news-card-image">
                      {article.heroImage ? (
                        <img src={article.heroImage} alt="" loading="lazy" />
                      ) : (
                        <div className="news-card-placeholder"><Newspaper size={32} /></div>
                      )}
                      <span className={`news-card-status status-${article.status}`}>
                        {article.status === 'discovered' ? 'Mới' :
                          article.status === 'extracting' ? 'Đang lấy' :
                          article.status === 'extract_failed' ? 'Lỗi' :
                          article.status === 'script_ready' ? `${article.bodyParagraphs} đoạn` :
                          article.status === 'generating' ? 'Đang gen' :
                          article.status === 'ready' ? 'Sẵn sàng' :
                          article.status === 'approved' ? '✓ Đã duyệt' : '✗ Đã bỏ'}
                      </span>
                      {article.category ? <span className="news-card-category">{article.category}</span> : null}
                    </div>
                    <div className="news-card-body">
                      <h3 title={article.title}>{article.title}</h3>
                      <p>{article.excerpt}</p>
                      <div className="news-card-meta">
                        <span><Clock size={11} /> {relativeTime(Date.parse(article.publishedAt) || Date.now())}</span>
                        <a href={article.sourceUrl} target="_blank" rel="noreferrer">Nguồn ↗</a>
                      </div>
                      <div className="news-card-actions">
                        <button type="button" className="news-action primary" onClick={() => handleArticleAction(article, 'use')}>
                          <PlayCircle size={14} /> Tạo video
                        </button>
                        {article.status === 'discovered' || article.status === 'extract_failed' ? (
                          <button type="button" className="news-action" onClick={() => handleArticleAction(article, 'extract')}>
                            ↻ Trích xuất
                          </button>
                        ) : null}
                        {article.status !== 'approved' ? (
                          <button type="button" className="news-action ok" onClick={() => handleArticleAction(article, 'approve')}>
                            ✓ Duyệt
                          </button>
                        ) : null}
                        {article.status !== 'rejected' ? (
                          <button type="button" className="news-action danger" onClick={() => handleArticleAction(article, 'reject')}>
                            ✗ Bỏ
                          </button>
                        ) : null}
                      </div>
                      {article.error ? <small className="news-card-error">{article.error}</small> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="workspace content-workspace">
          <form className="converter-panel" onSubmit={handleNewsSubmit}>
            <div className="studio-head">
              <span className="tool-card-icon"><Newspaper size={22} /></span>
              <div>
                <span className="eyebrow">News To Video</span>
                <h2>Tạo video nháp từ bài báo</h2>
                <p>Lấy metadata, nội dung chính, ảnh đại diện, tạo storyboard, script và render MP4 chờ duyệt.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="newsUrlInput">URL bài báo</label>
              <input
                id="newsUrlInput"
                type="url"
                placeholder="Dán link bài báo từ nguồn uy tín..."
                value={newsUrl}
                onChange={(event) => setNewsUrl(event.target.value)}
                required
              />
            </div>

            <div className="settings-grid">
              <div className="field">
                <label htmlFor="newsFormat">Khung hình</label>
                <select id="newsFormat" value={newsFormat} onChange={(event) => setNewsFormat(event.target.value as NewsVideoRequest['format'])}>
                  <option value="short">Dọc 9:16 · Shorts/TikTok</option>
                  <option value="landscape">Ngang 16:9 · YouTube</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="newsTone">Phong cách</label>
                <select id="newsTone" value={newsTone} onChange={(event) => setNewsTone(event.target.value as NewsVideoRequest['tone'])}>
                  <option value="newsroom">Newsroom chuẩn tin tức</option>
                  <option value="social">Social nhanh, bắt mắt</option>
                  <option value="executive">Executive tóm tắt gọn</option>
                </select>
              </div>
              <div className="field">
                <label>Pipeline</label>
                <div className="mini-metric">
                  <ShieldCheck size={18} />
                  <span>Duyệt trước khi đăng</span>
                </div>
              </div>
            </div>

            <label className="switch-row" htmlFor="autoPublishToggle">
              <input
                id="autoPublishToggle"
                type="checkbox"
                checked={newsAutoPublish}
                onChange={(event) => setNewsAutoPublish(event.target.checked)}
              />
              <span className="switch-ui" aria-hidden="true" />
              <span>
                <strong>Chuẩn bị hàng chờ auto publish</strong>
                <small>Hiện tạo publish plan giả lập. Khi cấu hình OAuth/API, có thể nối YouTube, TikTok và Google Sheet.</small>
              </span>
            </label>

            <div className="notice">
              <AlertTriangle size={20} />
              <span>Hãy kiểm tra quyền sử dụng ảnh/bài viết. Hệ thống tạo bản tóm tắt có attribution, không thay thế bước duyệt pháp lý/nội dung.</span>
            </div>

            <button className="primary-button" type="submit" disabled={newsBusy}>
              {newsBusy ? <Loader2 className="spin" size={21} /> : <PlayCircle size={21} />}
              {newsBusy ? 'Đang tạo video nháp...' : 'Tạo News Video Draft'}
            </button>
          </form>

          <aside className="status-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Approval Center</span>
                <h2>{newsResult ? newsResult.article.siteName || newsResult.article.host : 'Chờ bài viết'}</h2>
              </div>
              <span className={`job-badge ${newsError ? 'failed' : newsResult ? 'queued' : 'completed'}`}>
                {newsResult?.status || 'draft'}
              </span>
            </div>

            <p className={`side-copy ${newsError ? 'error-text' : ''}`}>{newsMessage}</p>
            {newsResult ? (
              <>
                <div className="article-card">
                  {newsResult.article.imageUrl ? <img src={newsResult.article.imageUrl} alt="" /> : null}
                  <div>
                    <strong>{newsResult.article.title}</strong>
                    <span>{newsResult.article.description || newsResult.article.url}</span>
                    <small>{newsResult.article.host}{newsResult.article.publishedAt ? ` · ${new Date(newsResult.article.publishedAt).toLocaleDateString('vi-VN')}` : ''}</small>
                  </div>
                </div>

                <DownloadList files={newsResult.files} />
                <ResultPreview files={newsResult.files} />

                <div className="storyboard-list">
                  {newsResult.slides.map((slide, index) => (
                    <div className="storyboard-item" key={`${slide.label}-${index}`}>
                      <em>{String(index + 1).padStart(2, '0')}</em>
                      <div>
                        <strong>{slide.headline}</strong>
                        <span>{slide.body.join(' ')}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="publish-grid">
                  <div><Send size={16} /><strong>YouTube</strong><span>{newsResult.publishPlan.youtube}</span></div>
                  <div><Send size={16} /><strong>TikTok</strong><span>{newsResult.publishPlan.tiktok}</span></div>
                  <div><FileSpreadsheet size={16} /><strong>Sheet</strong><span>{newsResult.publishPlan.sheet}</span></div>
                </div>
              </>
            ) : (
              <div className="capability-panel">
                <strong>Gợi ý module tiếp theo</strong>
                <span>Marketing video, PDF to video, Data report video, Long video to Shorts, Thumbnail Studio, Content Calendar và Brand Kit.</span>
              </div>
            )}
          </aside>
          </section>
        </>
      ) : activeTool === 'media' ? (
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
                      setSelectedFiles([]);
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

                <div className="tool-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder={`Tìm trong ${currentGroup.tools.length} tiện ích...`}
                    value={toolSearch}
                    onChange={(event) => setToolSearch(event.target.value)}
                    aria-label="Tìm tool"
                  />
                  {toolSearch ? (
                    <button type="button" className="tool-search-clear" onClick={() => setToolSearch('')} aria-label="Xoá tìm kiếm">
                      <XCircle size={14} />
                    </button>
                  ) : null}
                </div>

                <div className="tool-list">
                  {visibleTools.length === 0 ? (
                    <div className="tool-list-empty">
                      <Search size={18} />
                      Không có tool nào khớp "{toolSearch}".
                    </div>
                  ) : visibleTools.map((tool) => {
                    const usable = canUseTool(tool);
                    const disabledReason = toolDisabledReason(tool);

                    return (
                      <button
                        className={`tool-row ${selectedTool === tool.id ? 'active' : ''}`}
                        type="button"
                        key={tool.id}
                        onClick={() => {
                          setSelectedTool(tool.id);
                          setSelectedFiles([]);
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
                className={`upload-zone ${isDraggingFile ? 'dragging' : ''} ${selectedFiles.length ? 'has-file' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingFile(false);
                  selectUploadFiles(event.dataTransfer.files, 'append');
                }}
              >
                <input
                  ref={fileInputRef}
                  id="fileInput"
                  className="sr-only-file"
                  type="file"
                  multiple={!isScanTool}
                  accept={currentTool.accept}
                  capture={isScanTool ? 'environment' : undefined}
                  onChange={(event) => selectUploadFiles(event.target.files, 'append')}
                />
                <div className="upload-icon" aria-hidden="true">
                  {isScanTool ? <Camera size={24} /> : <UploadCloud size={24} />}
                </div>
                <div className="upload-copy">
                  <strong>
                    {selectedFiles.length === 0
                      ? (isScanTool ? 'Chụp tài liệu hoặc chọn ảnh scan' : 'Kéo thả file vào đây (chọn nhiều file để batch)')
                      : selectedFiles.length === 1
                        ? selectedFiles[0].name
                        : `${selectedFiles.length} file đã sẵn sàng`}
                  </strong>
                  <span>
                    {selectedFiles.length === 0
                      ? `Định dạng nhận: ${currentTool.accept}`
                      : selectedFiles.length === 1
                        ? formatBytes(selectedFiles[0].size)
                        : `${formatBytes(selectedFiles.reduce((sum, file) => sum + file.size, 0))} tổng cộng`}
                  </span>
                </div>
                <div className="upload-actions">
                  <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                    <UploadCloud size={18} />
                    {selectedFiles.length ? 'Thêm file' : 'Chọn file'}
                  </button>
                  {isScanTool ? (
                    <button type="button" className="secondary-button camera" onClick={openCamera}>
                      <Camera size={18} />
                      Camera
                    </button>
                  ) : null}
                  {selectedFiles.length > 0 ? (
                    <button type="button" className="secondary-button danger" onClick={clearUploadFiles}>
                      <XCircle size={18} />
                      Xoá hết
                    </button>
                  ) : null}
                </div>
              </div>

              {selectedFiles.length > 0 ? (
                <ul className="file-chips">
                  {selectedFiles.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="file-chip" title={file.name}>
                      <FileText size={14} aria-hidden="true" />
                      <span className="chip-name">{file.name}</span>
                      <small>{formatBytes(file.size)}</small>
                      <button
                        type="button"
                        aria-label={`Bỏ file ${file.name}`}
                        onClick={() => removeUploadFile(index)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <ToolOptionsPanel
              tool={currentTool.id}
              values={optionValues}
              onChange={setOptionValue}
              onReset={resetOptions}
            />

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

            {currentTool.needsRembg && !health?.rembgReady ? (
              <div className="notice">
                <AlertTriangle size={20} />
                <span>Tool xoá nền AI cần rembg. Cài local bằng: <code>python -m pip install "rembg[cpu]"</code> (lần đầu chạy sẽ tải model ~25-180MB tuỳ chọn).</span>
              </div>
            ) : null}

            <button className="primary-button" type="submit" disabled={fileBusy || !selectedFiles.length || !canUseTool(currentTool)}>
              {fileBusy ? <Loader2 className="spin" size={21} /> : <Download size={21} />}
              {fileBusy
                ? 'Đang chuyển đổi...'
                : selectedFiles.length > 1
                  ? `Chạy ${currentTool.title} cho ${selectedFiles.length} file`
                  : `Chạy ${currentTool.title}`}
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

            {fileResults.length > 1 && fileJobId ? (
              <a
                className="zip-button"
                href={zipUrl(fileJobId, fileResults.map((file) => file.fileName))}
                download={`convert-${fileJobId.slice(0, 8)}.zip`}
              >
                <Archive size={18} />
                Tải tất cả ({fileResults.length} file) thành ZIP
              </a>
            ) : null}

            <DownloadGroups items={fileItems} fallback={fileResults} />
            <ResultPreview files={fileResults} />

            <RecentJobsPanel entries={recentEntries} onPick={applyRecent} onClear={clearRecent} />

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

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
