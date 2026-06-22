import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Bell,
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  Clock,
  CornerDownLeft,
  Database,
  Download,
  Eraser,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileType2,
  Film,
  Filter,
  Globe,
  Code2,
  HelpCircle,
  History,
  Image,
  Keyboard,
  Languages,
  Layers,
  LifeBuoy,
  Link2,
  Loader2,
  LogOut,
  Mic,
  Newspaper,
  Palette,
  PlayCircle,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  UploadCloud,
  User,
  Volume2,
  Wand2,
  Workflow,
  XCircle,
  Zap
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  approveArticle,
  cloneVoice,
  convertFile,
  convertFiles,
  createJob,
  createNewsVideo,
  detectObjects,
  extractArticle,
  fetchTranscript,
  getHealth,
  getJob,
  getNewsFeed,
  getPreview,
  getTunnelStatus,
  refreshNews,
  rejectArticle,
  separateStems,
  startTunnel,
  stopTunnel,
  zipUrl
} from './api';
import type { TunnelStatus } from './api';
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
  DetectObjectsResult,
  OutputFormat,
  PreviewPayload,
  PreviewSheet,
  StemsResult,
  StemsStem,
  TranscriptResult
} from './types';

type ActiveTool = 'content' | 'media' | 'files' | 'transcript' | 'lab' | 'workflows' | 'library' | 'cloudflare';
type TranscriptView = 'plain' | 'timeline' | 'markdown' | 'srt';
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
    title: 'Upscale AI',
    description: 'Phóng ảnh 2x/3x/4x bằng AI super-resolution (EDSR/ESPCN/FSRCNN qua OpenCV), nét hơn hẳn phóng thường. Tự fallback Lanczos cho ảnh lớn.',
    accept: 'image/*',
    badge: 'AI'
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
    description: 'Quét giấy tờ kiểu CamScanner: tự phát hiện mép giấy, nắn phối cảnh phẳng, deskew và xuất bản scan đen-trắng/xám/màu sạch nét.',
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
    id: 'ocr-translate',
    title: 'OCR & Dịch thuật',
    description: 'Nhận diện chữ trong ảnh bằng Tesseract (tiếng Việt có dấu) rồi dịch Anh↔Việt, xuất file Markdown song ngữ.',
    accept: 'image/*',
    badge: 'AI'
  },
  {
    id: 'caption-image',
    title: 'Tạo mô tả ảnh (AI)',
    description: 'Sinh alt-text SEO, mô tả chi tiết hoặc mô tả sản phẩm e-commerce bằng AI vision (cần OPENAI_API_KEY). Xuất Markdown.',
    accept: 'image/*',
    badge: 'AI'
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
  'caption-image': [
    {
      type: 'select',
      key: 'captionMode',
      label: 'Kiểu mô tả',
      defaultValue: 'describe',
      help: 'Alt-text: ngắn cho SEO/accessibility. Mô tả: 2-4 câu chi tiết. Sản phẩm: tiêu đề + bán hàng + thuộc tính.',
      options: [
        { value: 'describe', label: 'Mô tả chi tiết' },
        { value: 'alt', label: 'Alt-text SEO (ngắn)' },
        { value: 'product', label: 'Mô tả sản phẩm (e-commerce)' }
      ]
    },
    {
      type: 'select',
      key: 'captionLang',
      label: 'Ngôn ngữ',
      defaultValue: 'vi',
      options: [
        { value: 'vi', label: 'Tiếng Việt' },
        { value: 'en', label: 'English' }
      ]
    }
  ],
  'ocr-translate': [
    {
      type: 'select',
      key: 'ocrLang',
      label: 'Ngôn ngữ OCR',
      defaultValue: 'vie+eng',
      help: 'Ngôn ngữ chữ trong ảnh để Tesseract nhận diện.',
      options: [
        { value: 'vie+eng', label: 'Việt + Anh' },
        { value: 'eng', label: 'Anh' },
        { value: 'vie', label: 'Việt' }
      ]
    },
    {
      type: 'select',
      key: 'targetLang',
      label: 'Dịch sang',
      defaultValue: 'vi',
      help: 'Ngôn ngữ đích của bản dịch.',
      options: [
        { value: 'vi', label: 'Tiếng Việt' },
        { value: 'en', label: 'English' }
      ]
    },
    {
      type: 'select',
      key: 'sourceLang',
      label: 'Ngôn ngữ nguồn',
      defaultValue: 'auto',
      help: 'Auto: suy ra từ ngôn ngữ đích (vd dịch sang Việt thì coi nguồn là Anh).',
      options: [
        { value: 'auto', label: 'Tự động' },
        { value: 'en', label: 'English' },
        { value: 'vi', label: 'Tiếng Việt' }
      ]
    }
  ],
  'scan-document': [
    {
      type: 'select',
      key: 'scanMode',
      label: 'Kiểu xuất',
      defaultValue: 'bw',
      help: 'Đen-trắng cho văn bản (rõ chữ, file nhẹ); Xám giữ sắc độ; Màu cho ảnh/CMND/hoá đơn có màu.',
      options: [
        { value: 'bw', label: 'Đen-trắng (văn bản)' },
        { value: 'gray', label: 'Xám' },
        { value: 'color', label: 'Màu (cân bằng trắng + tương phản)' }
      ]
    },
    {
      type: 'select',
      key: 'autoCrop',
      label: 'Tự nắn phối cảnh',
      defaultValue: 'true',
      help: 'Tự dò 4 góc tờ giấy và nắn phẳng. Tắt nếu ảnh đã là tài liệu phẳng (chỉ tăng tương phản).',
      options: [
        { value: 'true', label: 'Bật (phát hiện mép giấy)' },
        { value: 'false', label: 'Tắt (giữ nguyên khung)' }
      ]
    }
  ],
  'pdf-to-word': [
    {
      type: 'select',
      key: 'pdfMode',
      label: 'Kiểu PDF',
      defaultValue: 'auto',
      help: 'Auto sẽ dùng OCR khi PDF là bản scan/ảnh, còn PDF có text thật sẽ dùng pdf2docx.',
      options: [
        { value: 'auto', label: 'Auto: text thật hoặc scan OCR' },
        { value: 'editable', label: 'PDF có text thật (pdf2docx)' },
        { value: 'ocr', label: 'PDF scan / ảnh chụp (OCR)' }
      ]
    },
    {
      type: 'select',
      key: 'ocrLang',
      label: 'Ngôn ngữ OCR',
      defaultValue: 'vie+eng',
      options: [
        { value: 'vie+eng', label: 'Tiếng Việt + English (khuyên dùng)' },
        { value: 'vie', label: 'Chỉ Tiếng Việt' },
        { value: 'eng', label: 'Chỉ English' }
      ]
    },
    {
      type: 'select',
      key: 'ocrForce',
      label: 'Pipeline OCR',
      defaultValue: 'true',
      help: 'Force OCR = chạy OCR lại toàn bộ (cho PDF scan thật, giữ table chuẩn). Skip text = chỉ OCR trang chưa có text.',
      options: [
        { value: 'true', label: 'Force OCR (full quality, có tables)' },
        { value: 'false', label: 'Skip text pages (nhanh hơn)' }
      ]
    },
    {
      type: 'select',
      key: 'ocrDeskew',
      label: 'Tự nắn ảnh nghiêng',
      defaultValue: 'true',
      help: 'Tự xoay/nắn trang bị nghiêng do scan cong, cải thiện OCR + tables.',
      options: [
        { value: 'true', label: 'Bật (khuyên dùng)' },
        { value: 'false', label: 'Tắt' }
      ]
    },
    {
      type: 'select',
      key: 'ocrClean',
      label: 'Làm sạch ảnh trước OCR',
      defaultValue: 'true',
      options: [
        { value: 'true', label: 'Bật (clean noise, sắc nét hơn)' },
        { value: 'false', label: 'Tắt (giữ nguyên scan gốc)' }
      ]
    },
    { type: 'number', key: 'ocrDpi', label: 'Độ nét OCR fallback', help: 'Chỉ dùng khi không có ocrmypdf. 220 = cân bằng; 300 nếu chữ nhỏ.', min: 120, max: 360, step: 20, defaultValue: 220, suffix: ' DPI' },
    {
      type: 'select',
      key: 'pageLabel',
      label: 'Gắn nhãn trang vào DOCX',
      defaultValue: 'false',
      options: [
        { value: 'false', label: 'Không' },
        { value: 'true', label: 'Có (--- Trang 1 ---)' }
      ]
    }
  ],
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
    },
    {
      type: 'select',
      key: 'srModel',
      label: 'Model AI',
      defaultValue: 'espcn',
      help: 'ESPCN nhanh & cân bằng; FSRCNN nhanh nhất; EDSR nét nhất nhưng chậm (chỉ ảnh nhỏ ≤0.8MP). Ảnh lớn tự fallback Lanczos.',
      options: [
        { value: 'espcn', label: 'ESPCN (nhanh, cân bằng)' },
        { value: 'fsrcnn', label: 'FSRCNN (nhanh nhất)' },
        { value: 'edsr', label: 'EDSR (nét nhất, chậm)' }
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
  'remove-object': [
    {
      type: 'select',
      key: 'method',
      label: 'Engine inpaint',
      defaultValue: 'auto',
      options: [
        { value: 'auto', label: 'Auto LaMa/NS (khuyên dùng)' },
        { value: 'lama', label: 'AI LaMa' },
        { value: 'ldm', label: 'AI LDM' },
        { value: 'telea', label: 'Telea nhanh' },
        { value: 'ns', label: 'Navier-Stokes' }
      ]
    },
    { type: 'range', key: 'dilate', label: 'Mở rộng mask', min: 0, max: 40, defaultValue: 12, suffix: 'px' },
    { type: 'range', key: 'feather', label: 'Mềm mép', min: 0, max: 40, defaultValue: 3, suffix: 'px' },
    {
      type: 'select',
      key: 'removeShadow',
      label: 'Xóa bóng đổ',
      defaultValue: 'true',
      options: [{ value: 'true', label: 'Bật' }, { value: 'false', label: 'Tắt' }]
    },
    {
      type: 'select',
      key: 'removeReflection',
      label: 'Xóa phản chiếu/glare',
      defaultValue: 'true',
      options: [{ value: 'true', label: 'Bật' }, { value: 'false', label: 'Tắt' }]
    },
    {
      type: 'select',
      key: 'premium',
      label: 'Hậu kỳ cao cấp',
      defaultValue: 'true',
      options: [{ value: 'true', label: 'Bật' }, { value: 'false', label: 'Tắt' }]
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

interface NotificationItem {
  id: number;
  variant: 'success' | 'error' | 'info' | 'warning';
  title: string;
  detail?: string;
  at: number;
}

const NOTIF_LIMIT = 30;

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

// ====================== AI Lab + Workflow data ======================

type AILabPreview =
  | 'portrait' | 'landscape' | 'vintage' | 'beach'
  | 'palette' | 'crop' | 'text' | 'bilingual'
  | 'audiobars' | 'voicewave' | 'document';

type AILabCategory = 'image' | 'audio' | 'document';

interface AILabCard {
  id: string;
  title: string;
  description: string;
  longDescription?: string;
  tag: string;
  category: AILabCategory;
  accent: 'emerald' | 'peach' | 'violet' | 'sky' | 'rose' | 'amber';
  icon: 'eraser' | 'palette' | 'zap' | 'scan' | 'languages' | 'mic' | 'wand' | 'volume' | 'image';
  preview: AILabPreview;
  action?: { tool: FileToolId; group: FileGroupId; label: string };
  available: boolean;
  comingSoon?: string;
  premium?: boolean;
  popular?: boolean;
  formats: string[];
  processTime: string;
  maxSize: string;
  tips: string[];
  relatedIds: string[];
}

const aiLabCards: AILabCard[] = [
  {
    id: 'remove-bg',
    title: 'Xoá phông nền',
    description: 'Tách subject bằng U2Net / IS-Net, xuất PNG trong suốt — hợp ảnh sản phẩm và chân dung.',
    longDescription: 'Mô hình AI U2Net (mặc định) / IS-Net (chất lượng cao) / Silueta (chân dung) chạy local trong rembg. Output là PNG có alpha channel, sẵn sàng đặt lên background mới.',
    tag: 'Image · AI',
    category: 'image',
    accent: 'emerald',
    icon: 'eraser',
    preview: 'portrait',
    action: { tool: 'remove-background', group: 'images', label: 'Mở Xoá nền AI' },
    available: true,
    popular: true,
    formats: ['JPG', 'PNG', 'WebP'],
    processTime: '~3-5s',
    maxSize: '20 MB',
    tips: [
      'Ảnh nhân vật chính rõ ràng cho kết quả tốt nhất',
      'IS-Net General chậm hơn nhưng viền tóc / lông mịn hơn',
      'Sản phẩm nền trắng đôi khi dùng Chroma Key nhanh hơn'
    ],
    relatedIds: ['chroma', 'remove-object']
  },
  {
    id: 'upscale',
    title: 'AI Upscale',
    description: 'Phóng ảnh 4x bằng Lanczos + sharpen — sắc nét cho web hoặc in ấn.',
    longDescription: 'Lanczos resampling kết hợp unsharp mask để giữ chi tiết khi phóng to. Hợp ảnh nhỏ < 1000px cần in / chiếu màn hình lớn. Giới hạn cạnh dài 6000px để tránh OOM.',
    tag: 'Image · Enhance',
    category: 'image',
    accent: 'sky',
    icon: 'zap',
    preview: 'landscape',
    action: { tool: 'upscale-image', group: 'images', label: 'Mở Upscale' },
    available: true,
    popular: true,
    formats: ['JPG', 'PNG', 'WebP'],
    processTime: '~1-2s',
    maxSize: '15 MB',
    tips: [
      'Ảnh blurry sẵn không thể "tạo" chi tiết mới',
      'Chọn 2x cho web, 4x chỉ khi cần in cỡ A3+',
      'Sau upscale có thể chạy Compress để giảm size'
    ],
    relatedIds: ['scan-doc', 'crop']
  },
  {
    id: 'scan-doc',
    title: 'Phục hồi ảnh cũ',
    description: 'Làm sạch ảnh chụp giấy / phục hồi tài liệu: xoá noise, tăng tương phản, sharpen.',
    longDescription: 'Pipeline: auto-rotate theo EXIF → grayscale → CLAHE contrast → unsharp mask → export PNG. Cho ảnh chụp giấy bằng điện thoại trở nên dễ đọc như scan.',
    tag: 'Document · Scan',
    category: 'document',
    accent: 'amber',
    icon: 'scan',
    preview: 'vintage',
    action: { tool: 'scan-document', group: 'images', label: 'Mở Scan' },
    available: true,
    formats: ['JPG', 'PNG', 'HEIC'],
    processTime: '~2s',
    maxSize: '25 MB',
    tips: [
      'Chụp ảnh giấy phẳng, ánh sáng đều cho kết quả best',
      'Nếu chữ vẫn mờ, kết hợp Upscale 2x trước khi scan',
      'PDF nhiều trang: dùng PDF → PNG rồi scan từng trang'
    ],
    relatedIds: ['upscale', 'remove-object']
  },
  {
    id: 'remove-object',
    title: 'Xoá vật thể',
    description: 'Tự động phát hiện chủ thể hoặc vẽ vùng cần xoá — AI inpaint lấp ngay với context xung quanh.',
    longDescription: 'Pipeline 2-step: rembg phát hiện chủ thể (hoặc bạn vẽ thủ công bằng brush tool), sau đó OpenCV inpaint (Telea / Navier-Stokes) lấp lại vùng đã xoá bằng pixel context xung quanh. Phù hợp xoá người, vật thể nhỏ-trung khỏi ảnh phong cảnh.',
    tag: 'Image · AI Inpaint',
    category: 'image',
    accent: 'rose',
    icon: 'wand',
    preview: 'beach',
    action: { tool: 'remove-object', group: 'images', label: 'Mở Xoá vật thể' },
    available: true,
    formats: ['JPG', 'PNG', 'WebP'],
    processTime: '~5-10s',
    maxSize: '20 MB',
    tips: [
      'Auto detect: phù hợp với 1 chủ thể chính (người, sản phẩm) trên nền phong cảnh',
      'Manual brush: chính xác hơn cho nhiều vật thể nhỏ rải rác',
      'Vật thể quá lớn (>40% ảnh) sẽ để lại vết mờ — không nên xoá'
    ],
    relatedIds: ['remove-bg', 'scan-doc']
  },
  {
    id: 'chroma',
    title: 'Chuyển đổi phong cách',
    description: 'Chroma key đổi 1 màu nền đặc thành trong suốt. Auto detect màu góc hoặc HEX tuỳ ý.',
    longDescription: 'Phù hợp ảnh studio nền trắng / xanh chroma / đen. Nhanh hơn AI rembg cho trường hợp nền đặc. Có 2 mode: auto (lấy trung bình 4 góc) hoặc HEX tuỳ chỉnh.',
    tag: 'Image · Studio',
    category: 'image',
    accent: 'emerald',
    icon: 'palette',
    preview: 'palette',
    action: { tool: 'chroma-key', group: 'images', label: 'Mở Chroma Key' },
    available: true,
    formats: ['JPG', 'PNG'],
    processTime: '<1s',
    maxSize: '20 MB',
    tips: [
      'Logo nền trắng → chroma nhanh hơn rembg 10x',
      'Ảnh người trên xanh lá (greenscreen) → tăng tolerance',
      'Đảo lại: chroma key chỉ giữ subject 1 màu'
    ],
    relatedIds: ['remove-bg', 'crop']
  },
  {
    id: 'crop',
    title: 'Cắt ảnh thông minh',
    description: 'Crop theo tỉ lệ chuẩn (vuông, 16:9, 4:3, 3:2) hoặc kích thước tuỳ chỉnh, giữ trung tâm.',
    longDescription: 'Tỉ lệ preset: 1:1 (Instagram), 16:9 (YouTube), 4:5 (Reel), 9:16 (Story), 3:2 (DSLR), 4:3 (sách). Crop xung quanh trung tâm hoặc chọn 9 vị trí (góc / mép / center).',
    tag: 'Image · Edit',
    category: 'image',
    accent: 'violet',
    icon: 'image',
    preview: 'crop',
    action: { tool: 'crop-image', group: 'images', label: 'Mở Crop' },
    available: true,
    formats: ['JPG', 'PNG', 'WebP'],
    processTime: '<1s',
    maxSize: '30 MB',
    tips: [
      'Instagram post = 1:1, Reel = 9:16 dọc',
      'Sau crop có thể chạy Resize để xuống size chuẩn',
      'Crop center thường an toàn — chủ thể ở giữa ảnh'
    ],
    relatedIds: ['upscale', 'chroma']
  },
  {
    id: 'whisper',
    title: 'Tách nhạc & lời',
    description: 'Trích script video bằng AI Whisper local — YouTube karaoke, TikTok, Vimeo, kèm timestamp.',
    longDescription: 'Pipeline: yt-dlp lấy phụ đề có sẵn → fallback faster-whisper AI nếu video không có sub. Hỗ trợ karaoke tag <c> của YouTube — không bị lặp lyric. Xuất TXT / SRT / VTT / MD.',
    tag: 'Audio · Whisper',
    category: 'audio',
    accent: 'emerald',
    icon: 'mic',
    preview: 'audiobars',
    action: { tool: 'remove-background', group: 'images', label: 'Mở Transcript' },
    available: true,
    popular: true,
    formats: ['YouTube', 'TikTok', 'Vimeo', 'MP3'],
    processTime: '~30-60s',
    maxSize: '~30 phút',
    tips: [
      'Video có sub sẵn → tải sub trực tiếp (nhanh, miễn phí)',
      'Music video nhiều noise → tăng Whisper model size',
      'Karaoke YouTube được parse tag <c> tự động'
    ],
    relatedIds: ['voice-clone', 'caption']
  },
  {
    id: 'caption',
    title: 'Tạo mô tả ảnh',
    description: 'Sinh alt-text SEO, mô tả chi tiết hoặc mô tả sản phẩm e-commerce bằng AI vision (cần OPENAI_API_KEY).',
    longDescription: 'Dùng OpenAI vision (gpt-4o-mini) mô tả ảnh: 3 chế độ — alt-text SEO ngắn, mô tả chi tiết 2-4 câu, hoặc mô tả sản phẩm (tiêu đề + bán hàng + thuộc tính). Hỗ trợ tiếng Việt / English, xuất Markdown. Cần đặt biến môi trường OPENAI_API_KEY.',
    tag: 'AI · Vision',
    category: 'image',
    accent: 'peach',
    icon: 'languages',
    preview: 'text',
    action: { tool: 'caption-image', group: 'images', label: 'Mở Tạo mô tả' },
    available: true,
    formats: ['JPG', 'PNG'],
    processTime: '~5-8s',
    maxSize: '10 MB',
    tips: [
      'Alt-text auto giúp SEO + accessibility',
      'Chế độ "sản phẩm" trả tiêu đề + thuộc tính (màu, chất liệu)',
      'Cần OPENAI_API_KEY — đặt env rồi khởi động lại server'
    ],
    relatedIds: ['ocr-translate', 'remove-bg']
  },
  {
    id: 'ocr-translate',
    title: 'OCR & Dịch thuật',
    description: 'Nhận diện chữ trong ảnh bằng Tesseract (tiếng Việt có dấu) rồi dịch Anh↔Việt, xuất Markdown song ngữ.',
    longDescription: 'OCR bằng Tesseract (vie+eng) → trích text → dịch qua MyMemory API (miễn phí, không cần key). Xuất file Markdown gồm bản gốc + bản dịch. Chọn ngôn ngữ OCR, hướng dịch (Anh→Việt hoặc Việt→Anh).',
    tag: 'OCR · Dịch',
    category: 'document',
    accent: 'sky',
    icon: 'languages',
    preview: 'bilingual',
    action: { tool: 'ocr-translate', group: 'images', label: 'Mở OCR & Dịch' },
    available: true,
    formats: ['JPG', 'PNG'],
    processTime: '~3-5s',
    maxSize: '15 MB',
    tips: [
      'Tesseract hỗ trợ tiếng Việt có dấu (gói vie)',
      'Hợp tài liệu kỹ thuật / sách / menu nước ngoài',
      'Ảnh rõ nét → OCR chính xác hơn'
    ],
    relatedIds: ['caption', 'scan-doc']
  },
  {
    id: 'voice-clone',
    title: 'Nhân bản giọng nói',
    description: 'Clone giọng từ 6-30s mẫu rồi đọc văn bản bất kỳ bằng Coqui XTTS-v2 (chạy local trên CPU).',
    longDescription: 'XTTS-v2 clone giọng người bất kỳ từ vài giây sample, output WAV. Đa ngôn ngữ (en/es/fr/de/ja/zh/ko/ru...). Tiếng Việt cần model viXTTS bổ sung. Chạy local trên CPU nên mỗi câu mất ~30-90s.',
    tag: 'Audio · XTTS',
    category: 'audio',
    accent: 'peach',
    icon: 'volume',
    preview: 'voicewave',
    available: true,
    formats: ['WAV', 'MP3'],
    processTime: '~30-90s (CPU)',
    maxSize: '5 MB sample',
    tips: [
      'Sample sạch (không nhạc nền) cho output tự nhiên nhất',
      'Tiếng Việt: cần tải model viXTTS vào data/vixtts',
      'Tuyệt đối không clone giọng người khác trái phép'
    ],
    relatedIds: ['whisper', 'caption']
  }
];

interface WorkflowTemplate {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  accent: 'emerald' | 'peach' | 'violet' | 'sky' | 'rose' | 'amber';
  icon: 'youtube' | 'image' | 'mic' | 'film' | 'fileType' | 'workflow';
  steps: string[];
  target: { tab: 'media' | 'files' | 'transcript'; tool?: FileToolId; group?: FileGroupId; format?: OutputFormat };
  cta: string;
  badge?: string;
}

const workflowTemplates: WorkflowTemplate[] = [
  {
    id: 'youtube-to-blog',
    title: 'YouTube → Bài blog',
    subtitle: 'Video YouTube thành transcript markdown sẵn đăng',
    description: 'Lấy phụ đề YouTube (kể cả karaoke có tag <c>), fallback Whisper nếu cần, xuất Markdown với heading + timestamp.',
    accent: 'rose',
    icon: 'youtube',
    steps: ['Dán link YouTube', 'Trích sub / Whisper', 'Xuất Markdown đẹp'],
    target: { tab: 'transcript' },
    cta: 'Mở Transcript',
    badge: 'Phổ biến'
  },
  {
    id: 'podcast-to-script',
    title: 'Podcast → Script',
    subtitle: 'Audio podcast thành kịch bản có timestamp',
    description: 'Hỗ trợ Vimeo/SoundCloud/MP3 link. Whisper AI local xử lý audio dài, kèm dòng thời gian từng câu.',
    accent: 'peach',
    icon: 'mic',
    steps: ['Dán link audio', 'Whisper local', 'Tải SRT / TXT'],
    target: { tab: 'transcript' },
    cta: 'Mở Transcript',
    badge: 'AI'
  },
  {
    id: 'youtube-mp3',
    title: 'YouTube → MP3 nhạc',
    subtitle: 'Tải audio chất lượng cao từ video URL',
    description: 'Convert MP4/WebM thành MP3 320kbps. Bộ xử lý ffmpeg ổn định, giữ metadata, chuẩn hoá loudness.',
    accent: 'emerald',
    icon: 'youtube',
    steps: ['Dán link video', 'Chọn MP3', 'Tải về'],
    target: { tab: 'media', format: 'mp3' },
    cta: 'Mở Media URL'
  },
  {
    id: 'photos-web',
    title: 'Ảnh → Web tối ưu',
    subtitle: 'Resize 1920 + WebP cho website tải nhanh',
    description: 'Batch upload nhiều ảnh, resize cạnh dài 1920px, xuất WebP quality 84. Hợp portfolio + landing page.',
    accent: 'sky',
    icon: 'image',
    steps: ['Drag & drop ảnh', 'Resize 1920px', 'Xuất WebP batch'],
    target: { tab: 'files', tool: 'resize-image', group: 'images' },
    cta: 'Mở File Tools'
  },
  {
    id: 'photos-pdf',
    title: 'Ảnh → PDF hồ sơ',
    subtitle: 'Gộp nhiều ảnh thành PDF chuẩn giấy A4',
    description: 'Đóng JPEG/PNG thành PDF gọn, đúng tỉ lệ, sắp xếp theo thứ tự upload. Hợp gửi hồ sơ + in ấn.',
    accent: 'amber',
    icon: 'fileType',
    steps: ['Chọn nhiều ảnh', 'Convert image-to-pdf', 'Tải file PDF'],
    target: { tab: 'files', tool: 'image-to-pdf', group: 'images' },
    cta: 'Mở File Tools'
  },
  {
    id: 'excel-to-json',
    title: 'Excel → JSON API',
    subtitle: 'Xuất dữ liệu Excel thành JSON cho dev',
    description: 'Smart header detection bỏ qua banner row + merged cell. Giữ tên sheet, xuất JSON có structure.',
    accent: 'violet',
    icon: 'fileType',
    steps: ['Upload .xlsx', 'Convert', 'Xuất sheets[] JSON'],
    target: { tab: 'files', tool: 'excel-to-json', group: 'data' },
    cta: 'Mở File Tools'
  }
];

const RECENT_LIMIT = 12;
const RECENT_STORAGE_KEY = 'convert-url:recent-v1';

interface ToolPreset {
  id: string;
  name: string;
  tool: FileToolId;
  toolTitle: string;
  options: Record<string, string | number>;
  createdAt: number;
}
const PRESET_STORAGE_KEY = 'convert-url:presets-v1';
function loadPresets(): ToolPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function savePresets(list: ToolPreset[]) {
  try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* ignore */ }
}

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
  const [activeTool, setActiveTool] = useState<ActiveTool>('files');
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
  const [transcriptUrl, setTranscriptUrl] = useState('');
  const [transcriptLang, setTranscriptLang] = useState('auto');
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const [transcriptResult, setTranscriptResult] = useState<TranscriptResult | null>(null);
  const [transcriptView, setTranscriptView] = useState<TranscriptView>('plain');
  const [copiedField, setCopiedField] = useState<string>('');
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
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifSeenCount, setNotifSeenCount] = useState(0);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [headerMenu, setHeaderMenu] = useState<'none' | 'cmd' | 'notif' | 'health' | 'avatar'>('none');
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);
  const cmdInputRef = useRef<HTMLInputElement | null>(null);
  // Library filters
  const [libSearch, setLibSearch] = useState('');
  const [libView, setLibView] = useState<'grid' | 'list'>('grid');
  const [libTab, setLibTab] = useState<'recent' | 'shared' | 'presets'>('recent');
  const [libRange, setLibRange] = useState<'today' | '7d' | '30d' | 'all'>('all');
  const [libKind, setLibKind] = useState<'all' | 'image' | 'doc' | 'audio'>('all');
  const [libTools, setLibTools] = useState<Set<string>>(new Set());
  // AI Lab toolbar / modal
  const [labSearch, setLabSearch] = useState('');
  const [labCategory, setLabCategory] = useState<'all' | AILabCategory | 'premium' | 'soon'>('all');
  const [labSort, setLabSort] = useState<'popular' | 'az' | 'new'>('popular');
  const [labDetailId, setLabDetailId] = useState<string | null>(null);
  const [labRecentIds, setLabRecentIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('convert-url:lab-recent-v1');
      return raw ? (JSON.parse(raw) as string[]).slice(0, 4) : [];
    } catch { return []; }
  });
  // AI Lab workspace
  const [labView, setLabView] = useState<'grid' | 'workspace'>('grid');
  const [labWorkspaceCard, setLabWorkspaceCard] = useState<AILabCard | null>(null);
  const [labWsFile, setLabWsFile] = useState<File | null>(null);
  const [labWsPreview, setLabWsPreview] = useState<string>('');
  const [labWsBusy, setLabWsBusy] = useState(false);
  const [labWsResult, setLabWsResult] = useState<ConvertFile | null>(null);
  const [labWsError, setLabWsError] = useState('');
  const [labWsOptions, setLabWsOptions] = useState<Record<string, string | number>>({});
  const [labWsComparePos, setLabWsComparePos] = useState(50);
  const [labWsBg, setLabWsBg] = useState<'checker' | 'white' | 'black' | 'emerald' | 'custom'>('checker');
  const [labWsBgCustom, setLabWsBgCustom] = useState('#0F172A');
  const [labWsDragging, setLabWsDragging] = useState(false);
  const [labWsSrcDims, setLabWsSrcDims] = useState<{ w: number; h: number } | null>(null);
  const [labWsResultDims, setLabWsResultDims] = useState<{ w: number; h: number } | null>(null);
  const [labWsShowGrid, setLabWsShowGrid] = useState(true);
  const labWsInputRef = useRef<HTMLInputElement | null>(null);
  const labWsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Audio Studio (Tách nhạc & lời)
  const [labAudioMode, setLabAudioMode] = useState<'lyrics' | 'stems'>('lyrics');
  const [labAudioUrl, setLabAudioUrl] = useState('');
  const [labAudioBusy, setLabAudioBusy] = useState(false);
  const [labAudioResult, setLabAudioResult] = useState<TranscriptResult | null>(null);
  const [labAudioError, setLabAudioError] = useState('');
  const [labAudioLang, setLabAudioLang] = useState<string>('auto');
  const [labAudioUseWhisper, setLabAudioUseWhisper] = useState(false);
  const [labAudioView, setLabAudioView] = useState<'segments' | 'plain' | 'srt' | 'markdown'>('segments');
  const [labAudioCopiedField, setLabAudioCopiedField] = useState('');
  // Stems mode
  const [labStemsUrl, setLabStemsUrl] = useState('');
  const [labStemsModel, setLabStemsModel] = useState<'htdemucs' | 'htdemucs_ft' | 'mdx_extra'>('htdemucs');
  const [labStemsTwoMode, setLabStemsTwoMode] = useState(false);
  const [labStemsElapsed, setLabStemsElapsed] = useState(0);
  const [labStemsBusy, setLabStemsBusy] = useState(false);
  const [labStemsError, setLabStemsError] = useState('');
  const [labStemsResult, setLabStemsResult] = useState<StemsResult | null>(null);
  const [labStemsPlaying, setLabStemsPlaying] = useState(false);
  const [labStemsProgress, setLabStemsProgress] = useState(0); // 0..1
  const [labStemsDuration, setLabStemsDuration] = useState(0);
  const [labStemsCurrentTime, setLabStemsCurrentTime] = useState(0);
  const [labStemsVolumes, setLabStemsVolumes] = useState<Record<string, number>>({ vocals: 100, drums: 100, bass: 100, other: 100 });
  const [labStemsMuted, setLabStemsMuted] = useState<Record<string, boolean>>({ vocals: false, drums: false, bass: false, other: false });
  const [labStemsSolo, setLabStemsSolo] = useState<string | null>(null);
  const labStemsAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  // Voice clone (XTTS) workspace
  const [labVcSample, setLabVcSample] = useState<File | null>(null);
  const [labVcText, setLabVcText] = useState('');
  const [labVcLang, setLabVcLang] = useState('en');
  const [labVcBusy, setLabVcBusy] = useState(false);
  const [labVcError, setLabVcError] = useState('');
  const [labVcResult, setLabVcResult] = useState<ConvertFile | null>(null);
  // Cloudflare tunnel admin
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);
  // Tool presets (saved File Tools configs)
  const [presets, setPresets] = useState<ToolPreset[]>(loadPresets());
  const [presetName, setPresetName] = useState('');
  // Object removal (Inpaint) workspace
  const [labInpaintMode, setLabInpaintMode] = useState<'smart' | 'subject' | 'manual'>('smart');
  // Smart object detection (YOLOv8)
  const [labDetectResult, setLabDetectResult] = useState<DetectObjectsResult | null>(null);
  const [labRemoveIds, setLabRemoveIds] = useState<Set<number>>(new Set());
  const [labDetectBusy, setLabDetectBusy] = useState(false);
  const [labHoverObjId, setLabHoverObjId] = useState<number | null>(null);
  const [labInpaintBrushSize, setLabInpaintBrushSize] = useState(40);
  const [labInpaintTool, setLabInpaintTool] = useState<'brush' | 'eraser'>('brush');
  const [labInpaintHasStrokes, setLabInpaintHasStrokes] = useState(false);
  const [labInpaintAutoMask, setLabInpaintAutoMask] = useState<string>(''); // dataURL of detected subject overlay
  const [labInpaintAutoBusy, setLabInpaintAutoBusy] = useState(false);
  const labInpaintImageRef = useRef<HTMLImageElement | null>(null);
  const labInpaintMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labInpaintIsDrawingRef = useRef(false);
  const labInpaintLastPosRef = useRef<{ x: number; y: number } | null>(null);
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
    setNotifications((current) => {
      const next: NotificationItem = { id, variant: toast.variant, title: toast.title, detail: toast.detail, at: Date.now() };
      return [next, ...current].slice(0, NOTIF_LIMIT);
    });
    const ttl = toast.variant === 'error' ? 7000 : 4500;
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), ttl);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  function closeHeaderMenu() {
    setHeaderMenu('none');
    setCmdQuery('');
    setCmdIndex(0);
  }

  function toggleHeaderMenu(menu: 'cmd' | 'notif' | 'health' | 'avatar') {
    setHeaderMenu((current) => {
      if (current === menu) {
        setCmdQuery('');
        setCmdIndex(0);
        return 'none';
      }
      if (menu === 'notif') {
        setNotifSeenCount(notifications.length);
      }
      return menu;
    });
  }

  function clearNotifications() {
    setNotifications([]);
    setNotifSeenCount(0);
  }

  function dismissNotification(id: number) {
    setNotifications((current) => current.filter((n) => n.id !== id));
  }

  async function refreshHealth() {
    setHealthError('');
    try {
      const data = await getHealth();
      setHealth(data);
      pushToast({ variant: data.ready ? 'success' : 'info', title: 'Đã làm mới trạng thái', detail: data.ready ? 'Tất cả công cụ sẵn sàng.' : data.message });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Không kiểm tra được';
      setHealthError(msg);
      pushToast({ variant: 'error', title: 'Refresh health thất bại', detail: msg });
    }
  }

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

  // Elapsed timer while stems are processing (so the long demucs run shows progress).
  useEffect(() => {
    if (!labStemsBusy) { setLabStemsElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setLabStemsElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [labStemsBusy]);

  // Keep the header "Public" badge live regardless of which page is open.
  useEffect(() => {
    refreshTunnel();
    const t = setInterval(refreshTunnel, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOptionValues(defaultsForTool(selectedTool));
  }, [selectedTool]);

  // Load Cloudflare tunnel status when the admin page opens; poll while URL pending.
  useEffect(() => {
    if (activeTool !== 'cloudflare') return;
    refreshTunnel();
    const t = setInterval(() => {
      setTunnel((cur) => { if (cur && cur.running && !cur.url) refreshTunnel(); return cur; });
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // Global keyboard: Ctrl/Cmd+K opens palette, Esc closes any open header menu
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
      if (isCmdK) {
        e.preventDefault();
        setHeaderMenu((prev) => (prev === 'cmd' ? 'none' : 'cmd'));
        setCmdQuery('');
        setCmdIndex(0);
        return;
      }
      if (e.key === 'Escape') {
        setHeaderMenu('none');
        setCmdQuery('');
        setLabDetailId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-focus search input when command palette opens
  useEffect(() => {
    if (headerMenu === 'cmd') {
      window.setTimeout(() => cmdInputRef.current?.focus(), 30);
    }
  }, [headerMenu]);

  // Close header menus when clicking outside the topbar
  useEffect(() => {
    if (headerMenu === 'none') return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.forge-topbar') || target.closest('.forge-header-menu')) return;
      setHeaderMenu('none');
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [headerMenu]);

  // Read source image dimensions when preview URL changes
  useEffect(() => {
    if (!labWsPreview) { setLabWsSrcDims(null); return; }
    const img = new window.Image();
    img.onload = () => setLabWsSrcDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = labWsPreview;
  }, [labWsPreview]);

  // Read result image dimensions when result changes
  useEffect(() => {
    if (!labWsResult) { setLabWsResultDims(null); return; }
    const img = new window.Image();
    img.onload = () => setLabWsResultDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = labWsResult.downloadUrl;
  }, [labWsResult]);

  // Stems mode: time tracking + cleanup on unmount
  useEffect(() => {
    if (!labStemsResult || !labStemsPlaying) return;
    let raf: number;
    function tick() {
      const master = labStemsAudioRefs.current[labStemsResult!.stems[0]?.name];
      if (master) {
        setLabStemsCurrentTime(master.currentTime);
        if (labStemsDuration > 0) setLabStemsProgress(master.currentTime / labStemsDuration);
        if (master.ended || master.currentTime >= labStemsDuration - 0.1) {
          Object.values(labStemsAudioRefs.current).forEach((a) => a?.pause());
          setLabStemsPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [labStemsResult, labStemsPlaying, labStemsDuration]);

  useEffect(() => {
    // Cleanup when leaving lab tab or workspace
    if (activeTool !== 'lab' || labView !== 'workspace') {
      Object.values(labStemsAudioRefs.current).forEach((a) => a?.pause());
      setLabStemsPlaying(false);
    }
  }, [activeTool, labView]);

  // Keyboard: workspace Enter to process, R to reset
  useEffect(() => {
    if (labView !== 'workspace') return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (isTyping) return;
      if (e.key === 'Enter' && !labWsBusy && labWsFile && labWorkspaceCard?.available) {
        e.preventDefault();
        runLabWorkspace();
      } else if ((e.key === 'r' || e.key === 'R') && labWsResult) {
        e.preventDefault();
        resetLabWorkspace();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labView, labWsBusy, labWsFile, labWsResult, labWorkspaceCard]);

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
    setActiveTool('files');
    pushToast({ variant: 'info', title: 'Mở lại từ lịch sử', detail: entry.toolTitle });
  }

  function openFileTool(toolId: FileToolId, groupId?: FileGroupId) {
    const targetGroup = groupId ?? (toolGroups.find((group) => group.tools.some((t) => t.id === toolId))?.id);
    if (targetGroup) setActiveFileGroup(targetGroup as FileGroupId);
    setSelectedTool(toolId);
    setOptionValues(defaultsForTool(toolId));
    setSelectedFiles([]);
    setFileResults([]);
    setFileItems([]);
    setFileError(false);
    const tool = fileTools.find((item) => item.id === toolId);
    setFileMessage(tool ? `${tool.title} — sẵn sàng nhận file` : 'Chọn file để bắt đầu.');
    setActiveTool('files');
  }

  function applyWorkflow(template: WorkflowTemplate) {
    if (template.target.tab === 'transcript') {
      setActiveTool('transcript');
      pushToast({ variant: 'info', title: 'Workflow đã sẵn sàng', detail: template.title });
      return;
    }
    if (template.target.tab === 'media') {
      if (template.target.format) setFormat(template.target.format);
      setActiveTool('media');
      pushToast({ variant: 'info', title: 'Workflow đã sẵn sàng', detail: template.title });
      return;
    }
    if (template.target.tab === 'files' && template.target.tool) {
      openFileTool(template.target.tool, template.target.group);
      pushToast({ variant: 'success', title: 'Đã mở workflow', detail: template.title });
    }
  }

  function saveCurrentPreset() {
    const tool = fileTools.find((t) => t.id === selectedTool);
    const name = presetName.trim() || `${tool?.title ?? selectedTool} ${new Date().toLocaleDateString('vi-VN')}`;
    const preset: ToolPreset = {
      id: `${Date.now()}`,
      name,
      tool: selectedTool,
      toolTitle: tool?.title ?? selectedTool,
      options: { ...optionValues },
      createdAt: Date.now()
    };
    setPresets((cur) => {
      const next = [preset, ...cur].slice(0, 50);
      savePresets(next);
      return next;
    });
    setPresetName('');
    pushToast({ variant: 'success', title: 'Đã lưu preset', detail: name });
  }
  function applyPreset(preset: ToolPreset) {
    openFileTool(preset.tool);
    setOptionValues({ ...defaultsForTool(preset.tool), ...preset.options });
    pushToast({ variant: 'success', title: 'Đã áp preset', detail: preset.name });
  }
  function deletePreset(id: string) {
    setPresets((cur) => {
      const next = cur.filter((p) => p.id !== id);
      savePresets(next);
      return next;
    });
  }

  function deleteRecent(jobId: string) {
    setRecentEntries((current) => {
      const next = current.filter((entry) => entry.jobId !== jobId);
      saveRecent(next);
      return next;
    });
  }

  function pushLabRecent(id: string) {
    setLabRecentIds((current) => {
      const next = [id, ...current.filter((x) => x !== id)].slice(0, 4);
      try { localStorage.setItem('convert-url:lab-recent-v1', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function openLabCard(card: AILabCard) {
    pushLabRecent(card.id);
    // Text-output tools (Markdown) live in the Files tab, not the image workspace.
    if ((card.id === 'caption' || card.id === 'ocr-translate') && card.action) {
      openFileTool(card.action.tool, card.action.group);
      pushToast({ variant: 'success', title: 'Đã mở công cụ', detail: card.title });
      return;
    }
    resetLabWorkspace();
    // Reset audio workspace state for whisper
    if (card.id === 'whisper') {
      setLabAudioMode('lyrics');
      setLabAudioUrl('');
      setLabAudioResult(null);
      setLabAudioError('');
      setLabAudioView('segments');
    }
    // Reset voice clone workspace state
    if (card.id === 'voice-clone') {
      setLabVcSample(null);
      setLabVcText('');
      setLabVcResult(null);
      setLabVcError('');
    }
    // Reset inpaint state. Default to Smart (YOLO) detect — keep main, remove secondary.
    if (card.id === 'remove-object') {
      setLabInpaintMode('smart');
      setLabInpaintAutoMask('');
      setLabInpaintHasStrokes(false);
      setLabInpaintTool('brush');
      setLabDetectResult(null);
      setLabRemoveIds(new Set());
      setLabHoverObjId(null);
    }
    setLabWorkspaceCard(card);
    if (card.action && card.id !== 'whisper') {
      setLabWsOptions(defaultsForTool(card.action.tool));
    } else {
      setLabWsOptions({});
    }
    setLabView('workspace');
  }

  async function runVoiceClone() {
    if (!labVcSample) { setLabVcError('Cần upload 1 file giọng mẫu (audio).'); return; }
    if (!labVcText.trim()) { setLabVcError('Cần nhập nội dung cần đọc.'); return; }
    setLabVcBusy(true);
    setLabVcError('');
    setLabVcResult(null);
    try {
      const result = await cloneVoice(labVcSample, labVcText.trim(), labVcLang);
      if (!result.files.length) throw new Error('Không có audio trả về.');
      setLabVcResult(result.files[0]);
      pushToast({ variant: 'success', title: 'Nhân bản giọng thành công', detail: 'Audio đã sẵn sàng tải về.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nhân bản giọng thất bại';
      setLabVcError(msg);
      pushToast({ variant: 'error', title: 'Nhân bản giọng thất bại', detail: msg });
    } finally {
      setLabVcBusy(false);
    }
  }

  async function refreshTunnel() {
    try { setTunnel(await getTunnelStatus()); } catch { /* ignore */ }
  }
  async function doStartTunnel() {
    setTunnelBusy(true);
    try {
      const st = await startTunnel();
      setTunnel(st);
      pushToast({ variant: 'success', title: 'Đã mở tunnel', detail: st.url || 'Đang chờ URL…' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Mở tunnel thất bại';
      pushToast({ variant: 'error', title: 'Tunnel thất bại', detail: msg });
      await refreshTunnel();
    } finally {
      setTunnelBusy(false);
    }
  }
  async function doStopTunnel() {
    setTunnelBusy(true);
    try {
      setTunnel(await stopTunnel());
      pushToast({ variant: 'info', title: 'Đã tắt tunnel', detail: 'URL public không còn hiệu lực.' });
    } catch { /* ignore */ } finally {
      setTunnelBusy(false);
    }
  }

  async function runAudioWorkspace() {
    if (!labAudioUrl.trim()) {
      setLabAudioError('Cần URL video / audio để trích lời');
      return;
    }
    setLabAudioBusy(true);
    setLabAudioError('');
    setLabAudioResult(null);
    try {
      const languages = labAudioLang === 'auto' ? undefined : [labAudioLang];
      const result = await fetchTranscript({
        url: labAudioUrl.trim(),
        languages,
        useWhisper: labAudioUseWhisper
      });
      setLabAudioResult(result);
      pushToast({ variant: 'success', title: 'Trích lời thành công', detail: `${result.segments.length} dòng · ${result.languageLabel}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không trích được';
      setLabAudioError(msg);
      pushToast({ variant: 'error', title: 'Trích lời thất bại', detail: msg });
    } finally {
      setLabAudioBusy(false);
    }
  }

  async function copyAudioField(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setLabAudioCopiedField(key);
      window.setTimeout(() => setLabAudioCopiedField((c) => (c === key ? '' : c)), 1500);
    } catch {
      pushToast({ variant: 'error', title: 'Copy thất bại' });
    }
  }

  // ============ Stems mode functions ============
  async function runStemsSeparation() {
    if (!labStemsUrl.trim()) {
      setLabStemsError('Cần URL audio để tách stems');
      return;
    }
    setLabStemsBusy(true);
    setLabStemsError('');
    setLabStemsResult(null);
    stopAllStems();
    try {
      const result = await separateStems({ url: labStemsUrl.trim(), model: labStemsModel, twoStems: labStemsTwoMode });
      setLabStemsResult(result);
      setLabStemsDuration(result.duration);
      const vols: Record<string, number> = {};
      const muted: Record<string, boolean> = {};
      result.stems.forEach((s) => { vols[s.name] = 100; muted[s.name] = false; });
      setLabStemsVolumes(vols);
      setLabStemsMuted(muted);
      setLabStemsSolo(null);
      pushToast({ variant: 'success', title: 'Tách stems thành công', detail: `${result.stems.length} stems · ${result.durationLabel}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không tách được';
      setLabStemsError(msg);
      pushToast({ variant: 'error', title: 'Tách stems thất bại', detail: msg.length > 80 ? msg.slice(0, 80) + '…' : msg });
    } finally {
      setLabStemsBusy(false);
    }
  }

  function getStemEffectiveVolume(stemName: string): number {
    if (labStemsMuted[stemName]) return 0;
    if (labStemsSolo && labStemsSolo !== stemName) return 0;
    return (labStemsVolumes[stemName] ?? 100) / 100;
  }

  function applyStemsVolumes() {
    Object.entries(labStemsAudioRefs.current).forEach(([name, audio]) => {
      if (audio) audio.volume = getStemEffectiveVolume(name);
    });
  }

  function toggleStemsPlay() {
    if (!labStemsResult) return;
    const refs = labStemsAudioRefs.current;
    if (labStemsPlaying) {
      Object.values(refs).forEach((a) => a?.pause());
      setLabStemsPlaying(false);
    } else {
      // Sync all to same currentTime
      const t = labStemsCurrentTime;
      Object.values(refs).forEach((a) => {
        if (a) {
          a.currentTime = t;
          a.volume = getStemEffectiveVolume(Object.keys(refs).find((k) => refs[k] === a) || '');
        }
      });
      Promise.all(Object.values(refs).map((a) => a?.play().catch(() => undefined))).then(() => {
        setLabStemsPlaying(true);
      });
    }
  }

  function stopAllStems() {
    Object.values(labStemsAudioRefs.current).forEach((a) => {
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
    });
    setLabStemsPlaying(false);
    setLabStemsCurrentTime(0);
    setLabStemsProgress(0);
  }

  function seekStems(seconds: number) {
    Object.values(labStemsAudioRefs.current).forEach((a) => {
      if (a) a.currentTime = seconds;
    });
    setLabStemsCurrentTime(seconds);
    if (labStemsDuration > 0) setLabStemsProgress(seconds / labStemsDuration);
  }

  function setStemVolume(name: string, value: number) {
    setLabStemsVolumes((prev) => ({ ...prev, [name]: value }));
    const audio = labStemsAudioRefs.current[name];
    if (audio) audio.volume = labStemsMuted[name] ? 0 : (labStemsSolo && labStemsSolo !== name ? 0 : value / 100);
  }

  function toggleStemMute(name: string) {
    setLabStemsMuted((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      const audio = labStemsAudioRefs.current[name];
      if (audio) audio.volume = next[name] ? 0 : (labStemsSolo && labStemsSolo !== name ? 0 : labStemsVolumes[name] / 100);
      return next;
    });
  }

  function toggleStemSolo(name: string) {
    setLabStemsSolo((prev) => {
      const next = prev === name ? null : name;
      // Update all audio volumes immediately
      Object.entries(labStemsAudioRefs.current).forEach(([n, audio]) => {
        if (audio) {
          if (labStemsMuted[n]) {
            audio.volume = 0;
          } else if (next && next !== n) {
            audio.volume = 0;
          } else {
            audio.volume = labStemsVolumes[n] / 100;
          }
        }
      });
      return next;
    });
  }

  // ============ Inpaint (Remove Object) helpers ============
  function clearInpaintMask() {
    const canvas = labInpaintMaskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setLabInpaintHasStrokes(false);
    setLabInpaintAutoMask('');
  }

  function initInpaintCanvas() {
    const canvas = labInpaintMaskCanvasRef.current;
    const img = labInpaintImageRef.current;
    if (!canvas || !img) return;
    // Match canvas internal resolution to image natural size
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setLabInpaintHasStrokes(false);
  }

  function inpaintCanvasCoords(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = labInpaintMaskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const point = 'touches' in e ? e.touches[0] || e.changedTouches[0] : e;
    if (!point) return null;
    const x = ((point.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((point.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }

  function inpaintDrawAt(x: number, y: number) {
    const canvas = labInpaintMaskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Brush size scales with canvas resolution
    const scaledBrush = (labInpaintBrushSize / 100) * Math.min(canvas.width, canvas.height) * 0.15;
    const r = Math.max(4, scaledBrush);
    if (labInpaintTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(244, 63, 94, 0.55)'; // semi-transparent rose
    }
    const last = labInpaintLastPosRef.current;
    if (last) {
      // Draw line between last and current for smooth strokes
      ctx.beginPath();
      ctx.lineWidth = r * 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = labInpaintTool === 'eraser' ? 'rgba(0,0,0,1)' : 'rgba(244, 63, 94, 0.55)';
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    labInpaintLastPosRef.current = { x, y };
    if (labInpaintTool === 'brush' && !labInpaintHasStrokes) setLabInpaintHasStrokes(true);
  }

  function exportInpaintMaskDataUrl(): string | null {
    // Build binary B/W mask from current strokes (white = inpaint)
    const canvas = labInpaintMaskCanvasRef.current;
    if (!canvas) return null;
    const src = canvas.getContext('2d');
    if (!src) return null;
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const outCtx = out.getContext('2d');
    if (!outCtx) return null;
    outCtx.fillStyle = '#000';
    outCtx.fillRect(0, 0, out.width, out.height);
    const imgData = src.getImageData(0, 0, canvas.width, canvas.height);
    const outData = outCtx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      // Any alpha > 0 → white in output mask
      if (imgData.data[i + 3] > 5) {
        outData.data[i] = 255;
        outData.data[i + 1] = 255;
        outData.data[i + 2] = 255;
        outData.data[i + 3] = 255;
      }
    }
    outCtx.putImageData(outData, 0, 0);
    return out.toDataURL('image/png');
  }

  // OLD: rembg "remove main subject" (kept for 'subject' mode)
  async function detectInpaintSubject() {
    if (!labWsFile) return;
    setLabInpaintAutoBusy(true);
    try {
      const result = await convertFile('remove-background', labWsFile, { model: 'u2net' });
      if (result.files[0]) {
        setLabInpaintAutoMask(result.files[0].downloadUrl);
        pushToast({ variant: 'success', title: 'Đã phát hiện chủ thể', detail: 'Kiểm tra preview rồi bấm Xoá' });
      }
    } catch (err) {
      pushToast({ variant: 'error', title: 'Phát hiện thất bại', detail: err instanceof Error ? err.message.slice(0, 80) : '' });
    } finally {
      setLabInpaintAutoBusy(false);
    }
  }

  // NEW: YOLOv8 smart detect — find all objects, keep main, mark secondary for removal
  async function detectInpaintObjects() {
    if (!labWsFile) return;
    setLabDetectBusy(true);
    setLabWsError('');
    try {
      const result = await detectObjects(labWsFile, 'yolov8m-seg.pt');
      setLabDetectResult(result);
      // Default: select all secondary objects for removal
      setLabRemoveIds(new Set(result.objects.filter((o) => !o.isMain).map((o) => o.id)));
      if (result.objects.length === 0) {
        pushToast({ variant: 'info', title: 'Không phát hiện vật thể', detail: 'Thử Manual brush để vẽ tay vùng cần xoá.' });
      } else {
        pushToast({ variant: 'success', title: `Phát hiện ${result.objects.length} vật thể`, detail: `${result.mainCount} chủ thể chính · ${result.secondaryCount} vật thể phụ` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Phát hiện thất bại';
      setLabWsError(msg);
      pushToast({ variant: 'error', title: 'Phát hiện vật thể thất bại', detail: msg.slice(0, 80) });
    } finally {
      setLabDetectBusy(false);
    }
  }

  function toggleRemoveObject(id: number) {
    setLabRemoveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function loadImageEl(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Composite selected object masks into a single B/W mask dataURL
  async function buildObjectMaskDataUrl(): Promise<string | null> {
    if (!labDetectResult) return null;
    const selected = labDetectResult.objects.filter((o) => labRemoveIds.has(o.id));
    if (selected.length === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = labDetectResult.width;
    canvas.height = labDetectResult.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter'; // white OR white stays white
    for (const obj of selected) {
      try {
        const img = await loadImageEl(obj.maskUrl);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch { /* skip failed mask */ }
    }
    ctx.globalCompositeOperation = 'source-over';
    return canvas.toDataURL('image/png');
  }

  async function runInpaintWorkspace() {
    if (!labWsFile || !labWorkspaceCard) return;
    setLabWsBusy(true);
    setLabWsError('');
    try {
      const options: Record<string, string | number> = {
        mode: 'manual', // backend always uses provided mask
        method: String(labWsOptions.method ?? 'auto'),
        dilate: Number(labWsOptions.dilate ?? 12),
        feather: Number(labWsOptions.feather ?? 3),
        ldmSteps: Number(labWsOptions.ldmSteps ?? 35),
        removeShadow: String(labWsOptions.removeShadow ?? 'true'),
        removeReflection: String(labWsOptions.removeReflection ?? 'true'),
        premium: String(labWsOptions.premium ?? 'true')
      };

      if (labInpaintMode === 'smart') {
        const maskDataUrl = await buildObjectMaskDataUrl();
        if (!maskDataUrl) throw new Error('Chưa chọn vật thể nào để xoá. Tích vào vật thể phụ trong danh sách.');
        options.maskDataUrl = maskDataUrl;
      } else if (labInpaintMode === 'subject') {
        options.mode = 'auto'; // backend re-runs rembg to build mask
      } else {
        // manual brush
        const dataUrl = exportInpaintMaskDataUrl();
        if (!dataUrl) throw new Error('Không export được mask.');
        if (!labInpaintHasStrokes) throw new Error('Bạn chưa vẽ vùng nào để xoá. Dùng brush tool để bôi lên vật thể.');
        options.maskDataUrl = dataUrl;
      }

      const result = await convertFile('remove-object', labWsFile, options);
      if (!result.files.length) throw new Error('Không có file kết quả trả về');
      setLabWsResult(result.files[0]);
      setLabWsComparePos(50);
      pushToast({ variant: 'success', title: 'Đã xoá vật thể', detail: 'Kéo slider để so sánh trước/sau' });
      persistRecent(result, labWorkspaceCard.title);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra';
      setLabWsError(msg);
      pushToast({ variant: 'error', title: 'Xoá vật thể thất bại', detail: msg.length > 80 ? msg.slice(0, 80) + '…' : msg });
    } finally {
      setLabWsBusy(false);
    }
  }

  function downloadAudioFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function resetLabWorkspace() {
    setLabWsFile(null);
    if (labWsPreview) URL.revokeObjectURL(labWsPreview);
    setLabWsPreview('');
    setLabWsResult(null);
    setLabWsError('');
    setLabWsBusy(false);
    setLabWsComparePos(50);
    setLabWsBg('checker');
  }

  function backToLabGrid() {
    if (labWsPreview) URL.revokeObjectURL(labWsPreview);
    setLabView('grid');
    setLabWorkspaceCard(null);
    setLabWsFile(null);
    setLabWsPreview('');
    setLabWsResult(null);
    setLabWsError('');
    setLabWsOptions({});
  }

  function handleLabWsFile(file: File) {
    if (!file.type.startsWith('image/')) {
      pushToast({ variant: 'error', title: 'File không phải ảnh', detail: file.type });
      return;
    }
    if (labWsPreview) URL.revokeObjectURL(labWsPreview);
    const url = URL.createObjectURL(file);
    setLabWsFile(file);
    setLabWsPreview(url);
    setLabWsResult(null);
    setLabWsError('');
  }

  function setLabWsOption(key: string, value: string | number) {
    setLabWsOptions((prev) => ({ ...prev, [key]: value }));
  }

  function megapixels(w: number, h: number): string {
    const mp = (w * h) / 1_000_000;
    if (mp < 1) return `${Math.round(mp * 1000)} KP`;
    return `${mp.toFixed(1)} MP`;
  }

  function estimateUpscaledBytes(srcBytes: number, scale: number): number {
    // Heuristic: file size scales roughly with pixel count (~scale²) but PNG/WebP compression varies
    return Math.round(srcBytes * scale * scale * 0.85);
  }

  function loadLabSample(toolId: FileToolId) {
    // Generate a tiny 600×400 sample image client-side via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 600, 400);
    if (toolId === 'remove-background' || toolId === 'chroma-key') {
      grad.addColorStop(0, '#0F4D2A');
      grad.addColorStop(1, '#1A8348');
    } else if (toolId === 'upscale-image') {
      grad.addColorStop(0, '#FFA94D');
      grad.addColorStop(0.5, '#FF6B6B');
      grad.addColorStop(1, '#845EF7');
    } else if (toolId === 'scan-document') {
      grad.addColorStop(0, '#FEF3C7');
      grad.addColorStop(1, '#FCD34D');
    } else {
      grad.addColorStop(0, '#A7F3D0');
      grad.addColorStop(1, '#047857');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 400);
    // Subject (silhouette / shapes)
    if (toolId === 'remove-background' || toolId === 'chroma-key') {
      // Portrait silhouette
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath(); ctx.arc(300, 160, 70, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(190, 230, 220, 200);
    } else if (toolId === 'scan-document') {
      // Document with text lines
      ctx.fillStyle = '#fff';
      ctx.fillRect(80, 60, 440, 280);
      ctx.fillStyle = '#64748B';
      for (let i = 0; i < 12; i++) {
        ctx.fillRect(110, 90 + i * 20, 380 - (i % 3) * 60, 4);
      }
    } else if (toolId === 'crop-image') {
      // Landscape
      ctx.fillStyle = '#FBBF24';
      ctx.beginPath(); ctx.arc(460, 110, 32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#475569';
      ctx.beginPath(); ctx.moveTo(60, 400); ctx.lineTo(200, 200); ctx.lineTo(340, 400); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#64748B';
      ctx.beginPath(); ctx.moveTo(280, 400); ctx.lineTo(420, 180); ctx.lineTo(560, 400); ctx.closePath(); ctx.fill();
    } else {
      // Default abstract shapes
      ctx.fillStyle = 'rgba(255, 255, 255, .35)';
      ctx.beginPath(); ctx.arc(200, 150, 80, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(420, 260, 100, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Forge Sample', 300, 210);
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `sample-${toolId}.png`, { type: 'image/png' });
      handleLabWsFile(file);
    }, 'image/png');
  }

  async function pickColorWithEyeDropper() {
    // EyeDropper API — Chrome/Edge 95+
    const w = window as typeof window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
    if (!w.EyeDropper) {
      pushToast({ variant: 'info', title: 'EyeDropper không hỗ trợ', detail: 'Trình duyệt này không có color picker hệ thống. Dùng input HEX thay thế.' });
      return;
    }
    try {
      const result = await new w.EyeDropper().open();
      setLabWsOption('color', result.sRGBHex);
      setLabWsOption('target', 'custom');
      pushToast({ variant: 'success', title: 'Đã chọn màu', detail: result.sRGBHex });
    } catch {
      // user cancelled
    }
  }

  async function runLabWorkspace() {
    if (!labWorkspaceCard || !labWsFile || !labWorkspaceCard.action) return;
    setLabWsBusy(true);
    setLabWsError('');
    try {
      const result = await convertFile(labWorkspaceCard.action.tool, labWsFile, labWsOptions);
      if (!result.files.length) throw new Error('Không có file kết quả trả về');
      setLabWsResult(result.files[0]);
      setLabWsComparePos(50);
      pushToast({ variant: 'success', title: 'Hoàn tất!', detail: labWorkspaceCard.title });
      // Persist to library
      persistRecent(result, labWorkspaceCard.title);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Có lỗi xảy ra';
      setLabWsError(msg);
      pushToast({ variant: 'error', title: 'Xử lý thất bại', detail: msg });
    } finally {
      setLabWsBusy(false);
    }
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

  async function handleTranscriptSubmit(event: FormEvent | { preventDefault: () => void }, overrideLang?: string, useWhisper = false) {
    event.preventDefault();
    const url = transcriptUrl.trim();
    if (!url) {
      setTranscriptError('Dán URL video trước đã.');
      return;
    }
    const effectiveLang = (overrideLang || transcriptLang || 'auto').trim();
    setTranscriptBusy(true);
    setTranscriptError('');
    setTranscriptResult(null);
    try {
      const languages = effectiveLang === 'auto' ? ['vi', 'en'] : [effectiveLang, 'vi', 'en'];
      const result = await fetchTranscript({ url, languages, useWhisper });
      setTranscriptResult(result);
      setTranscriptView('plain');
      if (result.segments.length === 0) {
        pushToast({
          variant: 'info',
          title: 'Video không có phụ đề sẵn',
          detail: result.message || 'Cài faster-whisper để fallback transcribe.'
        });
      } else {
        const sourceLabel = result.source === 'manual' ? 'sub thủ công' : result.source === 'auto' ? 'auto-sub' : result.source === 'whisper' ? 'Whisper local' : 'không rõ';
        pushToast({
          variant: 'success',
          title: `Lấy được ${result.segments.length} dòng`,
          detail: `${sourceLabel} · ${result.languageLabel}`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Trích script thất bại.';
      setTranscriptError(message);
      pushToast({ variant: 'error', title: 'Trích script thất bại', detail: message });
    } finally {
      setTranscriptBusy(false);
    }
  }

  async function handleTranscriptPaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setTranscriptUrl(text.trim());
    } catch {
      setTranscriptError('Trình duyệt không cho phép đọc clipboard. Hãy dán bằng Ctrl+V.');
    }
  }

  async function copyToClipboard(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField((current) => (current === field ? '' : current)), 1500);
    } catch {
      pushToast({ variant: 'error', title: 'Copy thất bại', detail: 'Trình duyệt từ chối quyền clipboard.' });
    }
  }

  function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function transcriptSafeName(): string {
    const title = transcriptResult?.video.title || 'transcript';
    return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 80);
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

  // ====== Command palette items ======
  type CmdItem = {
    id: string;
    title: string;
    subtitle?: string;
    section: 'Trang' | 'Công cụ file' | 'Workflow' | 'Hành động';
    icon: 'media' | 'files' | 'transcript' | 'lab' | 'workflows' | 'library' | 'wand' | 'workflow' | 'refresh' | 'github' | 'help';
    keywords: string;
    run: () => void;
  };

  const cmdAllItems: CmdItem[] = useMemo(() => {
    const items: CmdItem[] = [
      { id: 'go:media', title: 'Media URL', subtitle: 'Tải video / audio từ link', section: 'Trang', icon: 'media', keywords: 'media url youtube tiktok video mp4 mp3', run: () => { setActiveTool('media'); closeHeaderMenu(); } },
      { id: 'go:files', title: 'File Tools', subtitle: '28 công cụ chuyển đổi file', section: 'Trang', icon: 'files', keywords: 'file convert excel json xml pdf image', run: () => { setActiveTool('files'); closeHeaderMenu(); } },
      { id: 'go:transcript', title: 'Transcript', subtitle: 'Trích script video bằng AI', section: 'Trang', icon: 'transcript', keywords: 'transcript script subtitle whisper youtube srt', run: () => { setActiveTool('transcript'); closeHeaderMenu(); } },
      { id: 'go:lab', title: 'AI Lab', subtitle: 'Bộ sưu tập AI', section: 'Trang', icon: 'lab', keywords: 'ai lab xoá nền remove background chroma upscale', run: () => { setActiveTool('lab'); closeHeaderMenu(); } },
      { id: 'go:workflows', title: 'Workflows', subtitle: '6 template 1-click', section: 'Trang', icon: 'workflows', keywords: 'workflow template quy trình youtube blog mp3 podcast', run: () => { setActiveTool('workflows'); closeHeaderMenu(); } },
      { id: 'go:library', title: 'Library', subtitle: `${recentEntries.length} job đã lưu`, section: 'Trang', icon: 'library', keywords: 'library history lịch sử recent', run: () => { setActiveTool('library'); closeHeaderMenu(); } },
    ];
    fileTools.forEach((tool) => {
      const groupId = (toolGroups.find((g) => g.tools.some((t) => t.id === tool.id))?.id ?? 'documents') as FileGroupId;
      items.push({
        id: `tool:${tool.id}`,
        title: tool.title,
        subtitle: tool.description,
        section: 'Công cụ file',
        icon: 'wand',
        keywords: `${tool.title} ${tool.id} ${tool.badge} ${tool.description}`.toLowerCase(),
        run: () => { openFileTool(tool.id, groupId); closeHeaderMenu(); }
      });
    });
    workflowTemplates.forEach((tpl) => {
      items.push({
        id: `wf:${tpl.id}`,
        title: tpl.title,
        subtitle: tpl.subtitle,
        section: 'Workflow',
        icon: 'workflow',
        keywords: `${tpl.title} ${tpl.subtitle} ${tpl.id}`.toLowerCase(),
        run: () => { applyWorkflow(tpl); closeHeaderMenu(); }
      });
    });
    items.push(
      { id: 'act:refresh-health', title: 'Refresh trạng thái backend', subtitle: 'Kiểm tra ffmpeg / yt-dlp / LibreOffice...', section: 'Hành động', icon: 'refresh', keywords: 'refresh health backend status', run: () => { refreshHealth(); closeHeaderMenu(); } },
      { id: 'act:clear-recent', title: 'Xoá toàn bộ lịch sử Library', subtitle: 'Xoá recentEntries trong trình duyệt', section: 'Hành động', icon: 'refresh', keywords: 'clear history library', run: () => { clearRecent(); pushToast({ variant: 'info', title: 'Đã xoá lịch sử' }); closeHeaderMenu(); } },
      { id: 'act:github', title: 'Mở repo GitHub', subtitle: 'github.com/TranVinhTanDat/Convert_URL', section: 'Hành động', icon: 'github', keywords: 'github source code repo', run: () => { window.open('https://github.com/TranVinhTanDat/Convert_URL', '_blank', 'noreferrer'); closeHeaderMenu(); } }
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentEntries.length]);

  const cmdFilteredItems = useMemo(() => {
    const q = cmdQuery.trim().toLowerCase();
    if (!q) return cmdAllItems;
    return cmdAllItems.filter((it) =>
      it.title.toLowerCase().includes(q) ||
      (it.subtitle ?? '').toLowerCase().includes(q) ||
      it.keywords.includes(q)
    );
  }, [cmdQuery, cmdAllItems]);

  const cmdGroupedItems = useMemo(() => {
    const groups: Record<string, CmdItem[]> = {};
    cmdFilteredItems.slice(0, 20).forEach((it) => {
      (groups[it.section] ??= []).push(it);
    });
    return Object.entries(groups);
  }, [cmdFilteredItems]);

  const unseenNotifs = Math.max(0, notifications.length - notifSeenCount);

  const healthChecks: Array<{ key: string; label: string; ok: boolean; hint: string }> = [
    { key: 'ffmpeg', label: 'FFmpeg', ok: !!health?.ffmpegReady, hint: 'Convert video / audio' },
    { key: 'ffprobe', label: 'FFprobe', ok: !!health?.ffprobeReady, hint: 'Đọc metadata media' },
    { key: 'ytdlp', label: 'yt-dlp', ok: !!health?.ytdlpReady, hint: 'Tải video URL + sub' },
    { key: 'libreoffice', label: 'LibreOffice', ok: !!health?.libreOfficeReady, hint: 'Word → PDF' },
    { key: 'pdf2docx', label: 'pdf2docx', ok: !!health?.pdf2docxReady, hint: 'PDF → Word (giữ table/format)' },
    { key: 'ocrmypdf', label: 'OCRmyPDF', ok: !!health?.ocrmypdfReady, hint: 'OCR PDF scan + tables' },
    { key: 'rembg', label: 'rembg (AI)', ok: !!health?.rembgReady, hint: 'Xoá nền ảnh' },
    { key: 'whisper', label: 'Whisper', ok: !!health?.whisperReady, hint: 'Transcript AI local' },
    { key: 'demucs', label: 'Demucs', ok: !!health?.demucsReady, hint: 'Tách stems audio AI' },
    { key: 'opencv', label: 'OpenCV', ok: !!health?.opencvReady, hint: 'Inpaint cv2 (xoá vật thể)' },
    { key: 'lama', label: 'LaMa AI', ok: !!health?.lamaReady, hint: 'Deep learning inpaint (best)' },
    { key: 'openai', label: 'OpenAI', ok: !!health?.openAIReady, hint: 'Fallback transcript cloud' }
  ];

  const okCount = healthChecks.filter((c) => c.ok).length;

  return (
    <div className="forge-shell">
      {/* ============ Sidebar ============ */}
      <aside className="forge-sidebar">
        <div className="forge-workspace">
          <span className="forge-brand-mark" aria-hidden="true">
            <Wand2 size={18} />
          </span>
          <div className="forge-workspace-name">
            <strong>Forge Studio</strong>
            <small>Personal workspace</small>
          </div>
        </div>

        <nav className="forge-nav" aria-label="Navigation">
          <div className="forge-nav-section">Workflow</div>
          <button type="button" className={`forge-nav-item ${activeTool === 'media' ? 'active' : ''}`} onClick={() => setActiveTool('media')}>
            <Link2 size={17} />
            <span>Media URL</span>
          </button>
          <button type="button" className={`forge-nav-item ${activeTool === 'files' ? 'active' : ''}`} onClick={() => setActiveTool('files')}>
            <FileSpreadsheet size={17} />
            <span>File Tools</span>
          </button>
          <button type="button" className={`forge-nav-item ${activeTool === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTool('transcript')}>
            <Mic size={17} />
            <span>Transcript</span>
          </button>

          <div className="forge-nav-section">Studio</div>
          <button type="button" className={`forge-nav-item ${activeTool === 'lab' ? 'active' : ''}`} onClick={() => setActiveTool('lab')}>
            <Sparkles size={17} />
            <span>AI Lab</span>
            <em className="forge-nav-badge forge-nav-badge-new">New</em>
          </button>
          <button type="button" className={`forge-nav-item ${activeTool === 'workflows' ? 'active' : ''}`} onClick={() => setActiveTool('workflows')}>
            <Settings2 size={17} />
            <span>Workflows</span>
            <em className="forge-nav-badge forge-nav-badge-count">6</em>
          </button>
          <button type="button" className={`forge-nav-item ${activeTool === 'library' ? 'active' : ''}`} onClick={() => setActiveTool('library')}>
            <Archive size={17} />
            <span>Library</span>
            {recentEntries.length > 0 ? <em className="forge-nav-badge forge-nav-badge-count">{recentEntries.length}</em> : null}
          </button>
          <button type="button" className={`forge-nav-item ${activeTool === 'cloudflare' ? 'active' : ''}`} onClick={() => setActiveTool('cloudflare')}>
            <Globe size={17} />
            <span>Cloudflare</span>
            {tunnel?.running ? <em className="forge-nav-badge forge-nav-badge-count" style={{ background: '#16a34a' }}>●</em> : null}
          </button>
        </nav>

        <div className="forge-usage">
          <div className="forge-usage-label">
            <span>Usage này tháng</span>
            <span>247/500</span>
          </div>
          <div className="forge-usage-bar"><div style={{ width: '49.4%' }} /></div>
          <div className="forge-usage-meta">Free tier · còn 253 conversions</div>
          <button type="button" className="forge-usage-upgrade">
            <Sparkles size={13} /> Upgrade to Pro
          </button>
        </div>
      </aside>

      {/* ============ Main area ============ */}
      <div className="forge-main">
        <header className="forge-topbar">
          <div className="forge-breadcrumb">
            <strong>Forge Studio</strong>
            <Clock size={11} />
            <span>{activeTool === 'media' ? 'Media URL' : activeTool === 'files' ? 'File Tools' : activeTool === 'transcript' ? 'Transcript' : activeTool === 'lab' ? 'AI Lab' : activeTool === 'workflows' ? 'Workflows' : activeTool === 'library' ? 'Library' : activeTool === 'cloudflare' ? 'Cloudflare' : 'Dashboard'}</span>
          </div>

          <button type="button" className="forge-cmdk" onClick={() => toggleHeaderMenu('cmd')}>
            <Search size={14} />
            <span>Search or jump to…</span>
            <span className="forge-cmdk-kbd">Ctrl+K</span>
          </button>

          <div className="forge-topbar-actions">
            <button
              type="button"
              onClick={() => setActiveTool('cloudflare')}
              title={tunnel?.running ? `Tunnel đang chạy: ${tunnel.url ?? 'đang lấy URL'}` : 'Mở/quản lý Cloudflare tunnel'}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 999,
                border: '1px solid ' + (tunnel?.running ? 'rgba(22,163,74,.5)' : 'rgba(127,127,127,.3)'),
                background: tunnel?.running ? 'rgba(22,163,74,.12)' : 'transparent',
                color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 13
              }}
            >
              <Globe size={15} />
              <span>Public</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: tunnel?.running ? '#16a34a' : '#9ca3af', display: 'inline-block' }} />
            </button>
            <button
              type="button"
              className={`forge-icon-btn ${headerMenu === 'notif' ? 'is-open' : ''}`}
              title="Notifications"
              aria-label="Notifications"
              onClick={() => toggleHeaderMenu('notif')}
            >
              <Bell size={17} />
              {unseenNotifs > 0 ? <span className="forge-notification-dot">{unseenNotifs > 9 ? '9+' : unseenNotifs}</span> : null}
            </button>
            <button
              type="button"
              className={`forge-icon-btn ${headerMenu === 'health' ? 'is-open' : ''}`}
              title={ready ? 'Hệ thống sẵn sàng' : 'Cần kiểm tra'}
              aria-label="Health"
              onClick={() => toggleHeaderMenu('health')}
            >
              <CheckCircle2 size={17} style={{ color: ready ? 'var(--forge-success)' : 'var(--forge-warning)' }} />
            </button>
            <button
              type="button"
              className={`forge-avatar ${headerMenu === 'avatar' ? 'is-open' : ''}`}
              title="Đạt"
              onClick={() => toggleHeaderMenu('avatar')}
            >
              Đ
            </button>
          </div>

          {/* ============ Command Palette ============ */}
          {headerMenu === 'cmd' ? (
            <>
              <div className="forge-cmd-backdrop" onClick={closeHeaderMenu} />
              <div className="forge-cmd-panel forge-header-menu" role="dialog" aria-label="Command palette">
                <div className="forge-cmd-input-wrap">
                  <Search size={16} />
                  <input
                    ref={cmdInputRef}
                    type="text"
                    className="forge-cmd-input"
                    placeholder="Tìm trang, công cụ, workflow, hành động…"
                    value={cmdQuery}
                    onChange={(e) => { setCmdQuery(e.target.value); setCmdIndex(0); }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIndex((i) => Math.min(i + 1, cmdFilteredItems.length - 1)); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIndex((i) => Math.max(i - 1, 0)); }
                      else if (e.key === 'Enter') { e.preventDefault(); cmdFilteredItems[cmdIndex]?.run(); }
                    }}
                  />
                  <kbd className="forge-cmd-kbd-esc">Esc</kbd>
                </div>
                <div className="forge-cmd-results">
                  {cmdFilteredItems.length === 0 ? (
                    <div className="forge-cmd-empty">
                      <Search size={28} />
                      <strong>Không tìm thấy</strong>
                      <span>Thử từ khoá khác hoặc xoá bộ lọc</span>
                    </div>
                  ) : (
                    cmdGroupedItems.map(([section, items]) => (
                      <div className="forge-cmd-group" key={section}>
                        <div className="forge-cmd-group-label">{section}</div>
                        {items.map((it) => {
                          const flatIdx = cmdFilteredItems.indexOf(it);
                          const Icon =
                            it.icon === 'media' ? Link2 :
                            it.icon === 'files' ? FileSpreadsheet :
                            it.icon === 'transcript' ? Mic :
                            it.icon === 'lab' ? Sparkles :
                            it.icon === 'workflows' ? Workflow :
                            it.icon === 'library' ? Archive :
                            it.icon === 'workflow' ? Workflow :
                            it.icon === 'refresh' ? RefreshCw :
                            it.icon === 'github' ? Code2 :
                            it.icon === 'help' ? HelpCircle :
                            Wand2;
                          return (
                            <button
                              type="button"
                              key={it.id}
                              className={`forge-cmd-item ${flatIdx === cmdIndex ? 'active' : ''}`}
                              onClick={() => it.run()}
                              onMouseEnter={() => setCmdIndex(flatIdx)}
                            >
                              <span className="forge-cmd-item-icon"><Icon size={15} /></span>
                              <span className="forge-cmd-item-text">
                                <strong>{it.title}</strong>
                                {it.subtitle ? <small>{it.subtitle}</small> : null}
                              </span>
                              {flatIdx === cmdIndex ? <CornerDownLeft size={13} className="forge-cmd-item-enter" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
                <div className="forge-cmd-foot">
                  <span><kbd>↑</kbd><kbd>↓</kbd> chọn</span>
                  <span><kbd>↵</kbd> mở</span>
                  <span><kbd>Esc</kbd> đóng</span>
                  <span className="forge-cmd-foot-count">{cmdFilteredItems.length} kết quả</span>
                </div>
              </div>
            </>
          ) : null}

          {/* ============ Notifications dropdown ============ */}
          {headerMenu === 'notif' ? (
            <div className="forge-header-menu forge-notif-menu" role="dialog" aria-label="Thông báo">
              <div className="forge-menu-head">
                <div>
                  <strong>Thông báo</strong>
                  <small>{notifications.length} sự kiện gần đây</small>
                </div>
                {notifications.length > 0 ? (
                  <button type="button" className="forge-menu-link" onClick={clearNotifications}>
                    <Trash2 size={12} /> Xoá tất cả
                  </button>
                ) : null}
              </div>
              <div className="forge-notif-list">
                {notifications.length === 0 ? (
                  <div className="forge-notif-empty">
                    <Bell size={28} />
                    <strong>Chưa có thông báo</strong>
                    <span>Job hoàn tất, lỗi và cảnh báo sẽ hiện ở đây</span>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div className={`forge-notif-item variant-${n.variant}`} key={n.id}>
                      <span className="forge-notif-icon">
                        {n.variant === 'success' ? <CheckCircle2 size={15} /> :
                         n.variant === 'error' ? <XCircle size={15} /> :
                         n.variant === 'warning' ? <AlertTriangle size={15} /> :
                         <Sparkles size={15} />}
                      </span>
                      <div className="forge-notif-body">
                        <strong>{n.title}</strong>
                        {n.detail ? <span>{n.detail}</span> : null}
                        <em>{relativeTime(n.at)}</em>
                      </div>
                      <button
                        type="button"
                        className="forge-notif-close"
                        aria-label="Đóng"
                        onClick={() => dismissNotification(n.id)}
                      >
                        <XCircle size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {/* ============ Health status dropdown ============ */}
          {headerMenu === 'health' ? (
            <div className="forge-header-menu forge-health-menu" role="dialog" aria-label="Trạng thái backend">
              <div className="forge-menu-head">
                <div>
                  <strong>Trạng thái backend</strong>
                  <small>{ready ? `${okCount}/${healthChecks.length} công cụ sẵn sàng` : 'Cần kiểm tra kết nối'}</small>
                </div>
                <button type="button" className="forge-menu-link" onClick={refreshHealth}>
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              <div className="forge-health-summary">
                <div className={`forge-health-pill ${ready ? 'ok' : 'warn'}`}>
                  {ready ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  <span>{ready ? 'Sẵn sàng' : 'Có cảnh báo'}</span>
                </div>
                <small>Node {health?.nodeVersion ?? '—'}</small>
              </div>
              <div className="forge-health-list">
                {healthChecks.map((c) => (
                  <div className={`forge-health-row ${c.ok ? 'ok' : 'off'}`} key={c.key}>
                    <span className="forge-health-dot" />
                    <div className="forge-health-row-body">
                      <strong>{c.label}</strong>
                      <small>{c.hint}</small>
                    </div>
                    <span className="forge-health-status">{c.ok ? 'OK' : 'Offline'}</span>
                  </div>
                ))}
              </div>
              {healthError ? (
                <div className="forge-health-error">
                  <AlertTriangle size={13} /> {healthError}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ============ Avatar menu ============ */}
          {headerMenu === 'avatar' ? (
            <div className="forge-header-menu forge-avatar-menu" role="menu" aria-label="Tài khoản">
              <div className="forge-avatar-head">
                <div className="forge-avatar-big">Đ</div>
                <div>
                  <strong>Đạt</strong>
                  <small>Free tier · 247 / 500 conversions</small>
                </div>
              </div>
              <div className="forge-avatar-usage">
                <div className="forge-avatar-usage-bar"><div style={{ width: '49.4%' }} /></div>
                <small>49.4% sử dụng tháng này · còn 253 conversions</small>
              </div>
              <div className="forge-menu-list">
                <button type="button" className="forge-menu-item" onClick={() => { setActiveTool('library'); closeHeaderMenu(); }}>
                  <Archive size={14} /> <span>Lịch sử Library</span>
                  <em>{recentEntries.length}</em>
                </button>
                <button type="button" className="forge-menu-item" onClick={() => { toggleHeaderMenu('cmd'); }}>
                  <Keyboard size={14} /> <span>Command Palette</span>
                  <em><kbd>⌘K</kbd></em>
                </button>
                <button type="button" className="forge-menu-item" onClick={() => { setActiveTool('workflows'); closeHeaderMenu(); }}>
                  <Workflow size={14} /> <span>Workflow templates</span>
                  <em>6</em>
                </button>
                <button type="button" className="forge-menu-item" onClick={() => { refreshHealth(); closeHeaderMenu(); }}>
                  <RefreshCw size={14} /> <span>Refresh trạng thái</span>
                </button>
              </div>
              <div className="forge-menu-list">
                <a className="forge-menu-item" href="https://github.com/TranVinhTanDat/Convert_URL" target="_blank" rel="noreferrer" onClick={closeHeaderMenu}>
                  <Code2 size={14} /> <span>Mã nguồn GitHub</span>
                  <em><ExternalLink size={11} /></em>
                </a>
                <a className="forge-menu-item" href="https://github.com/TranVinhTanDat/Convert_URL/issues/new" target="_blank" rel="noreferrer" onClick={closeHeaderMenu}>
                  <LifeBuoy size={14} /> <span>Báo lỗi / góp ý</span>
                  <em><ExternalLink size={11} /></em>
                </a>
                <a className="forge-menu-item" href="https://github.com/TranVinhTanDat/Convert_URL#readme" target="_blank" rel="noreferrer" onClick={closeHeaderMenu}>
                  <BookOpen size={14} /> <span>Hướng dẫn sử dụng</span>
                  <em><ExternalLink size={11} /></em>
                </a>
              </div>
              <div className="forge-menu-list">
                <button type="button" className="forge-menu-item danger" onClick={() => { clearRecent(); clearNotifications(); pushToast({ variant: 'info', title: 'Đã reset workspace' }); closeHeaderMenu(); }}>
                  <LogOut size={14} /> <span>Reset workspace</span>
                </button>
              </div>
              <div className="forge-avatar-foot">
                <Sparkles size={11} /> Forge Studio v3.0 · build {new Date().getFullYear()}
              </div>
            </div>
          ) : null}
        </header>

        <div className="forge-canvas">
          {/* OLD app-shell content rendered inside Forge canvas */}
          <div className="app-shell" style={{ width: '100%', maxWidth: '100%', padding: 0, margin: 0 }}>

      <div className="tool-tabs" role="tablist" aria-label="Nhóm công cụ" style={{ display: 'none' }}>
        {/* Tabs now in sidebar — old tabs kept hidden as state controller */}
        {false && (
        <button type="button" className={activeTool === 'content' ? 'active' : ''} onClick={() => setActiveTool('content')}>
          <Newspaper size={18} />
          Content Studio
        </button>
        )}
        <button type="button" className={activeTool === 'media' ? 'active' : ''} onClick={() => setActiveTool('media')}>
          <Link2 size={18} />
          Media URL
        </button>
        <button type="button" className={activeTool === 'files' ? 'active' : ''} onClick={() => setActiveTool('files')}>
          <FileSpreadsheet size={18} />
          File Tools
        </button>
        <button type="button" className={activeTool === 'transcript' ? 'active' : ''} onClick={() => setActiveTool('transcript')}>
          <Mic size={18} />
          Trích Script
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
      ) : activeTool === 'transcript' ? (
        <section className="forge-transcript-section">
          {/* HERO */}
          <div className="forge-media-hero">
            <span className="forge-eyebrow"><Mic size={12} /> Transcript Extractor</span>
            <h1 className="forge-h1">
              Trích script từ <em>bất kỳ video</em>
            </h1>
            <p className="forge-subhead">
              Lấy phụ đề YouTube/TikTok/Vimeo, hoặc dùng Whisper AI transcribe local khi không có sub. Tự nhận diện loại nội dung — music, talk, tutorial, news.
            </p>
          </div>

          <form onSubmit={handleTranscriptSubmit}>
            <div className="forge-url-input-wrap">
              <Mic size={20} className="forge-url-icon" />
              <input
                type="url"
                className="forge-url-input"
                placeholder="https://www.youtube.com/watch?v=…"
                autoComplete="off"
                value={transcriptUrl ?? ''}
                onChange={(event) => setTranscriptUrl(event.target.value)}
                required
              />
              <button className="forge-url-paste" type="button" onClick={handleTranscriptPaste} title="Dán từ clipboard">
                <Clipboard size={14} /> Paste
              </button>
            </div>

            <div className="forge-options-grid" style={{ gridTemplateColumns: '1fr 1fr', maxWidth: 720 }}>
              <div className="forge-option-card">
                <div className="forge-option-head">
                  <span className="forge-option-label">Ngôn ngữ ưu tiên</span>
                  <span className="forge-option-icon"><Languages size={16} /></span>
                </div>
                <select className="forge-select" value={transcriptLang ?? 'auto'} onChange={(event) => setTranscriptLang(event.target.value)}>
                  <option value="auto">Tự động (vi → en)</option>
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                  <option value="ja">日本語 Japanese</option>
                  <option value="ko">한국어 Korean</option>
                  <option value="zh">中文 Chinese</option>
                  <option value="fr">Français</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                  <option value="th">ไทย Thai</option>
                </select>
              </div>
              <div className="forge-option-card">
                <div className="forge-option-head">
                  <span className="forge-option-label">Pipeline</span>
                  <span className="forge-option-icon"><Sparkles size={16} /></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'var(--forge-surface-alt)', fontSize: 13 }}>
                  <span style={{ color: 'var(--forge-success)' }}>●</span>
                  <span style={{ color: 'var(--forge-ink)' }}>yt-dlp sub</span>
                  <span style={{ color: 'var(--forge-muted-soft)' }}>→</span>
                  <span style={{ color: health?.whisperReady ? 'var(--forge-success)' : 'var(--forge-muted-soft)' }}>●</span>
                  <span style={{ color: health?.whisperReady ? 'var(--forge-ink)' : 'var(--forge-muted)' }}>Whisper {health?.whisperReady ? '✓' : '(off)'}</span>
                </div>
                {!health?.whisperReady ? (
                  <small style={{ fontSize: 11.5, color: 'var(--forge-muted)' }}>
                    Cài: <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>pip install faster-whisper-cli</code>
                  </small>
                ) : null}
              </div>
            </div>

            <button className="forge-cta" type="submit" disabled={transcriptBusy || !transcriptUrl.trim()}>
              {transcriptBusy ? <Loader2 className="spin" size={18} /> : <Mic size={18} />}
              {transcriptBusy ? 'Đang trích script…' : 'Lấy script ngay'}
            </button>

            {transcriptError ? (
              <div className="forge-notice danger" style={{ maxWidth: 720, margin: '16px auto 0' }}>
                <AlertTriangle size={16} />
                <span>{transcriptError}</span>
              </div>
            ) : null}
          </form>

          {/* RESULTS */}
          {transcriptResult ? (
            <div className="forge-transcript-results">
              {/* MAIN — transcript content */}
              <div className="forge-transcript-main">
                <div className="forge-transcript-toolbar">
                  <div className="forge-segmented">
                    {([
                      { value: 'plain' as const, label: 'Văn bản' },
                      { value: 'timeline' as const, label: 'Timeline' },
                      { value: 'markdown' as const, label: 'Markdown' },
                      { value: 'srt' as const, label: 'SRT' }
                    ]).map((tab) => (
                      <button
                        key={tab.value}
                        type="button"
                        className={transcriptView === tab.value ? 'active' : ''}
                        onClick={() => setTranscriptView(tab.value)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="forge-action-row">
                    <button
                      type="button"
                      className="forge-action-btn"
                      onClick={() => copyToClipboard(
                        transcriptView === 'srt' ? transcriptResult.srt :
                        transcriptView === 'markdown' ? transcriptResult.paragraphsMarkdown :
                        transcriptView === 'timeline' ? transcriptResult.segments.map((s) => `[${s.startLabel}] ${s.text}`).join('\n') :
                        transcriptResult.plainText,
                        'view'
                      )}
                    >
                      {copiedField === 'view' ? <ClipboardCheck size={13} /> : <Clipboard size={13} />}
                      {copiedField === 'view' ? 'Đã copy' : 'Copy'}
                    </button>
                    <button type="button" className="forge-action-btn" onClick={() => downloadTextFile(`${transcriptSafeName()}.txt`, transcriptResult.plainText)}>
                      <Download size={13} /> .txt
                    </button>
                    <button type="button" className="forge-action-btn" onClick={() => downloadTextFile(`${transcriptSafeName()}.srt`, transcriptResult.srt)}>
                      <Download size={13} /> .srt
                    </button>
                    <button type="button" className="forge-action-btn" onClick={() => downloadTextFile(`${transcriptSafeName()}.vtt`, transcriptResult.vtt, 'text/vtt;charset=utf-8')}>
                      <Download size={13} /> .vtt
                    </button>
                    <button type="button" className="forge-action-btn" onClick={() => downloadTextFile(`${transcriptSafeName()}.md`, transcriptResult.paragraphsMarkdown, 'text/markdown;charset=utf-8')}>
                      <Download size={13} /> .md
                    </button>
                  </div>
                </div>

                <div className="forge-transcript-content">
                  {transcriptResult.segments.length === 0 ? (
                    <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--forge-muted)' }}>
                      <AlertTriangle size={28} style={{ color: 'var(--forge-warning)' }} />
                      <div style={{ fontWeight: 600, marginTop: 8, color: 'var(--forge-ink)' }}>Video không có phụ đề</div>
                      <div style={{ marginTop: 4, fontSize: 13 }}>{transcriptResult.message || 'Cần cài faster-whisper để transcribe.'}</div>
                    </div>
                  ) : transcriptView === 'plain' ? (
                    <pre className="forge-transcript-text">{transcriptResult.plainText}</pre>
                  ) : transcriptView === 'markdown' ? (
                    <pre className="forge-transcript-text mono">{transcriptResult.paragraphsMarkdown}</pre>
                  ) : transcriptView === 'srt' ? (
                    <pre className="forge-transcript-text mono">{transcriptResult.srt}</pre>
                  ) : (
                    <ol className="forge-timeline">
                      {transcriptResult.segments.map((segment) => (
                        <li key={segment.index}>
                          <a
                            href={`${transcriptResult.video.webpageUrl}${transcriptResult.video.webpageUrl.includes('?') ? '&' : '?'}t=${Math.floor(segment.startSeconds)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="forge-timeline-ts"
                            title="Mở đúng đoạn này trên video gốc"
                          >
                            {segment.startLabel}
                          </a>
                          <span>{segment.text}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>

              {/* SIDE — video meta + actions */}
              <aside className="forge-transcript-side">
                <div className="forge-video-card">
                  <div className="forge-video-thumb">
                    {transcriptResult.video.thumbnail ? (
                      <img src={transcriptResult.video.thumbnail} alt="" />
                    ) : (
                      <div className="forge-video-thumb-fallback"><Mic size={48} /></div>
                    )}
                  </div>
                  <div className="forge-video-body">
                    <div className="forge-video-title">{transcriptResult.video.title}</div>
                    <div className="forge-video-meta">
                      <span><Clock size={12} /> {transcriptResult.video.durationLabel}</span>
                      {transcriptResult.video.uploader ? <span>· {transcriptResult.video.uploader}</span> : null}
                      <span>· {transcriptResult.video.host}</span>
                    </div>
                  </div>
                  <div className="forge-badge-stack">
                    <span className={`forge-badge content-${transcriptResult.video.contentType}`}>
                      {transcriptResult.video.contentTypeLabel}
                    </span>
                    {transcriptResult.segments.length > 0 ? (
                      <span className="forge-badge count">{transcriptResult.segments.length} dòng</span>
                    ) : null}
                    <span className="forge-badge lang">{transcriptResult.languageLabel}</span>
                    <span className={`forge-badge source-${transcriptResult.source}`}>
                      {transcriptResult.source === 'manual' ? 'Sub thủ công' :
                        transcriptResult.source === 'auto' ? 'Auto-sub (ASR)' :
                        transcriptResult.source === 'whisper' ? 'Whisper local ✓' : 'Không có sub'}
                    </span>
                  </div>
                </div>

                {transcriptResult.qualityWarning ? (
                  <div className={`forge-notice ${transcriptResult.video.contentType === 'music' && transcriptResult.source === 'auto' ? 'danger' : 'warning'}`}>
                    <AlertTriangle size={16} />
                    <span>{transcriptResult.qualityWarning}</span>
                  </div>
                ) : null}

                {transcriptResult.warning ? (
                  <div className="forge-notice info">
                    <Sparkles size={16} />
                    <span>{transcriptResult.warning}</span>
                  </div>
                ) : null}

                {transcriptResult.source !== 'whisper' && health?.whisperReady ? (
                  <button
                    type="button"
                    className="forge-whisper-cta"
                    onClick={() => void handleTranscriptSubmit({ preventDefault: () => {} }, undefined, true)}
                    disabled={transcriptBusy}
                  >
                    {transcriptBusy ? <Loader2 className="spin" size={15} /> : <Mic size={15} />}
                    {transcriptBusy ? 'Đang chạy Whisper…' : 'Re-run với Whisper'}
                  </button>
                ) : null}

                {transcriptResult.availableLanguages.length > 1 ? (
                  <div className="forge-langs">
                    <strong>Các ngôn ngữ khác có sẵn</strong>
                    <div className="forge-langs-list">
                      {transcriptResult.availableLanguages
                        .filter((lang) => lang.code !== transcriptResult.language)
                        .slice(0, 24)
                        .map((lang) => (
                          <button
                            key={lang.code}
                            type="button"
                            className="forge-lang-chip"
                            onClick={() => void handleTranscriptSubmit({ preventDefault: () => {} }, lang.code)}
                            title={`Tải lại với ${lang.label}${lang.auto ? ' (auto)' : ''}`}
                          >
                            {lang.code}{lang.auto ? ' ·auto' : ''}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}
              </aside>
            </div>
          ) : null}
        </section>
      ) : activeTool === 'media' ? (
        <section className="forge-media-section">
          {/* HERO */}
          <div className="forge-media-hero">
            <span className="forge-eyebrow">
              <Link2 size={12} /> Media URL Converter
            </span>
            <h1 className="forge-h1">
              Convert any video URL. <em>Beautifully.</em>
            </h1>
            <p className="forge-subhead">
              Dán link YouTube, TikTok, Vimeo, Twitter — chúng tôi xử lý mọi nền tảng. MP4 chất lượng tốt nhất, MP3 audio rõ.
            </p>
          </div>

          <form onSubmit={handleMediaSubmit}>
            {/* GIANT URL INPUT */}
            <div className="forge-url-input-wrap">
              <Link2 size={20} className="forge-url-icon" />
              <input
                id="urlInput"
                type="url"
                className="forge-url-input"
                placeholder="https://www.youtube.com/watch?v=…"
                autoComplete="off"
                value={url ?? ''}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
              <button
                className="forge-url-paste"
                type="button"
                onClick={handlePaste}
                title="Dán từ clipboard (Ctrl+V)"
              >
                <Clipboard size={14} /> Paste
              </button>
            </div>

            <div className="forge-url-examples">
              <span>Thử với:</span>
              <button type="button" className="forge-url-example" onClick={() => setUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}>youtube.com</button>
              <button type="button" className="forge-url-example" onClick={() => setUrl('https://www.tiktok.com/@user/video/123')}>tiktok.com</button>
              <button type="button" className="forge-url-example" onClick={() => setUrl('https://vimeo.com/76979871')}>vimeo.com</button>
            </div>

            {/* 3-COLUMN OPTION GRID */}
            <div className="forge-options-grid">
              <div className="forge-option-card">
                <div className="forge-option-head">
                  <span className="forge-option-label">Định dạng</span>
                  <span className="forge-option-icon">{format === 'mp4' ? <Download size={16} /> : <Mic size={16} />}</span>
                </div>
                <div className="forge-format-toggle">
                  <button type="button" className={format === 'mp4' ? 'active' : ''} onClick={() => setFormat('mp4')}>
                    <Download size={14} /> MP4 Video
                  </button>
                  <button type="button" className={format === 'mp3' ? 'active' : ''} onClick={() => setFormat('mp3')}>
                    <Mic size={14} /> MP3 Audio
                  </button>
                </div>
              </div>

              <div className="forge-option-card">
                <div className="forge-option-head">
                  <span className="forge-option-label">Chất lượng</span>
                  <span className="forge-option-icon"><Sparkles size={16} /></span>
                </div>
                <select className="forge-select" value={quality ?? 'best'} onChange={(event) => setQuality(event.target.value)} disabled={format === 'mp3'}>
                  <option value="best">Tốt nhất (auto)</option>
                  <option value="2160">2160p · 4K</option>
                  <option value="1440">1440p · QHD</option>
                  <option value="1080">1080p · Full HD</option>
                  <option value="720">720p · HD</option>
                  <option value="480">480p · SD</option>
                  <option value="360">360p · Mobile</option>
                </select>
                <div className="forge-toggle-row">
                  <small style={{ fontSize: 12, color: 'var(--forge-muted)' }}>MP4 tương thích Windows</small>
                  <button
                    type="button"
                    className={`forge-toggle ${compatibility && format !== 'mp3' ? 'on' : ''}`}
                    onClick={() => format !== 'mp3' && setCompatibility(!compatibility)}
                    disabled={format === 'mp3'}
                    aria-label="MP4 compatibility"
                  />
                </div>
              </div>

              <div className="forge-option-card">
                <div className="forge-option-head">
                  <span className="forge-option-label">Phạm vi</span>
                  <span className="forge-option-icon"><Archive size={16} /></span>
                </div>
                <select className="forge-select" value={playlist ?? 'single'} onChange={(event) => setPlaylist(event.target.value as CreateJobPayload['playlist'])}>
                  <option value="single">Một video</option>
                  <option value="playlist">Cả playlist</option>
                </select>
                <select className="forge-select" value={filename ?? 'title'} onChange={(event) => setFilename(event.target.value as CreateJobPayload['filename'])}>
                  <option value="title">Tên: Tiêu đề + ID</option>
                  <option value="id">Tên: Chỉ ID</option>
                </select>
              </div>
            </div>

            <div className="forge-tip">
              <AlertTriangle size={16} />
              <span>Chỉ chuyển đổi nội dung bạn sở hữu, có giấy phép, hoặc được tác giả cho phép. Hỗ trợ 1800+ platforms qua yt-dlp.</span>
            </div>

            <button className="forge-cta" type="submit" disabled={busy || !ready}>
              {busy ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
              {busy ? 'Đang xử lý…' : 'Bắt đầu chuyển đổi'}
            </button>
          </form>

          {/* PROGRESS / RESULT */}
          {job.id ? (
            <div className="forge-progress-card" style={{ marginTop: 40 }}>
              <div className="forge-progress-head">
                <div className="forge-progress-thumb">
                  {job.status === 'completed' ? <CheckCircle2 size={32} style={{ color: 'var(--forge-success)' }} /> :
                    job.status === 'failed' ? <XCircle size={32} style={{ color: 'var(--forge-danger)' }} /> :
                    <Loader2 size={32} className="spin" style={{ color: 'var(--forge-primary)' }} />}
                </div>
                <div className="forge-progress-info">
                  <div className="forge-progress-title">{statusTitle(job)}</div>
                  <div className="forge-progress-meta">
                    {job.step} · {Math.max(0, Math.min(100, job.progress))}%
                  </div>
                </div>
              </div>
              <div className="forge-progress-bar-wrap">
                <div className="forge-progress-stages">
                  <div className={`forge-progress-stage ${job.progress > 0 ? 'done' : ''}`} />
                  <div className={`forge-progress-stage ${job.progress >= 25 ? (job.progress >= 50 ? 'done' : 'active') : ''}`} />
                  <div className={`forge-progress-stage ${job.progress >= 50 ? (job.progress >= 80 ? 'done' : 'active') : ''}`} />
                  <div className={`forge-progress-stage ${job.progress >= 80 ? (job.progress >= 100 ? 'done' : 'active') : ''}`} />
                </div>
                <div className="forge-progress-stage-labels">
                  <span className={job.progress > 0 ? 'done' : ''}>Khởi tạo</span>
                  <span className={job.progress >= 25 ? (job.progress >= 50 ? 'done' : 'active') : ''}>Tải xuống</span>
                  <span className={job.progress >= 50 ? (job.progress >= 80 ? 'done' : 'active') : ''}>Xử lý</span>
                  <span className={job.progress >= 100 ? 'done' : (job.progress >= 80 ? 'active' : '')}>Hoàn tất</span>
                </div>
              </div>
              {logs && logs !== 'Log sẽ xuất hiện tại đây.' ? (
                <div className="forge-progress-log" ref={logRef}>
                  {logs.split('\n').slice(-12).map((line, idx) => <div key={idx}>{line}</div>)}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* DOWNLOADS */}
          {job.files.length > 0 ? (
            <div className="forge-downloads">
              {job.files.map((file) => (
                <div className="forge-download-card" key={file.downloadUrl}>
                  <div className="forge-download-icon">
                    <Download size={20} />
                  </div>
                  <div className="forge-download-info">
                    <div className="forge-download-name">{file.fileName}</div>
                    <div className="forge-download-meta">{formatBytes(file.size)}</div>
                  </div>
                  <div className="forge-download-actions">
                    <a className="forge-download-btn" href={file.downloadUrl} target="_blank" rel="noreferrer">Mở</a>
                    <a className="forge-download-btn primary" href={file.downloadUrl} download={file.fileName}>
                      <Download size={13} /> Tải về
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {job.files.length > 0 ? (
            <div style={{ maxWidth: 720, margin: '20px auto 0' }}>
              <ResultPreview files={job.files} />
            </div>
          ) : null}
        </section>
      ) : activeTool === 'lab' && labView === 'workspace' && labWorkspaceCard ? (
        (() => {
          const card = labWorkspaceCard;
          const Icon =
            card.icon === 'eraser' ? Eraser :
            card.icon === 'palette' ? Palette :
            card.icon === 'zap' ? Zap :
            card.icon === 'scan' ? ScanLine :
            card.icon === 'languages' ? Languages :
            card.icon === 'mic' ? Mic :
            card.icon === 'wand' ? Wand2 :
            card.icon === 'volume' ? Volume2 :
            Image;

          // Soon / Premium → roadmap page
          if (!card.available) {
            return (
              <section className={`forge-labws forge-labws-soon accent-${card.accent}`}>
                <button type="button" className="forge-labws-back" onClick={backToLabGrid}>
                  <ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} /> Quay lại AI Lab
                </button>
                <div className="forge-labws-soon-hero">
                  <div className="forge-labws-soon-icon"><Icon size={36} /></div>
                  <div className="forge-labws-soon-pill">
                    {card.premium ? (<><Sparkles size={11} /> PREMIUM · {card.comingSoon ?? 'Sắp ra'}</>) : (<><Clock size={11} /> {card.comingSoon ?? 'Sắp ra mắt'}</>)}
                  </div>
                  <h1>{card.title}</h1>
                  <p>{card.longDescription ?? card.description}</p>
                </div>

                <div className="forge-labws-soon-grid">
                  <div className="forge-labws-soon-block">
                    <div className="forge-labws-soon-block-title"><Sparkles size={13} /> Tính năng dự kiến</div>
                    <ul>
                      {card.tips.map((tip, i) => (
                        <li key={i}><CheckCircle2 size={12} /> {tip}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="forge-labws-soon-block">
                    <div className="forge-labws-soon-block-title"><Wand2 size={13} /> Thông số kỹ thuật</div>
                    <div className="forge-labws-soon-specs">
                      <div><small>ĐỊNH DẠNG</small><div className="forge-labws-soon-fmts">{card.formats.map((f) => <em key={f}>{f}</em>)}</div></div>
                      <div><small>THỜI GIAN</small><strong><Clock size={11} /> {card.processTime}</strong></div>
                      <div><small>GIỚI HẠN</small><strong><Layers size={11} /> {card.maxSize}</strong></div>
                      <div><small>TRẠNG THÁI</small><strong className={card.premium ? 'premium' : 'soon'}>{card.premium ? 'Đang lab' : 'Đang phát triển'}</strong></div>
                    </div>
                  </div>
                </div>

                {card.relatedIds.length > 0 ? (
                  <div className="forge-labws-soon-related">
                    <div className="forge-labws-soon-block-title"><Workflow size={13} /> Trong khi chờ, thử các công cụ tương tự</div>
                    <div className="forge-labws-soon-related-row">
                      {card.relatedIds
                        .map((id) => aiLabCards.find((c) => c.id === id))
                        .filter((c): c is AILabCard => !!c)
                        .map((c) => {
                          const RIcon =
                            c.icon === 'eraser' ? Eraser :
                            c.icon === 'palette' ? Palette :
                            c.icon === 'zap' ? Zap :
                            c.icon === 'scan' ? ScanLine :
                            c.icon === 'languages' ? Languages :
                            c.icon === 'mic' ? Mic :
                            c.icon === 'wand' ? Wand2 :
                            c.icon === 'volume' ? Volume2 :
                            Image;
                          return (
                            <button key={c.id} type="button" className={`forge-labws-related-card accent-${c.accent}`} onClick={() => openLabCard(c)}>
                              <span className="forge-labws-related-icon"><RIcon size={14} /></span>
                              <div>
                                <strong>{c.title}</strong>
                                <small>{c.description.slice(0, 60)}…</small>
                              </div>
                              <ArrowRight size={13} />
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ) : null}

                <div className="forge-labws-soon-foot">
                  <button type="button" className="forge-labws-foot-link" onClick={backToLabGrid}>← Khám phá công cụ khác</button>
                  <button type="button" className="forge-labws-foot-cta" onClick={() => { window.open('https://github.com/TranVinhTanDat/Convert_URL/issues/new', '_blank', 'noreferrer'); }}>
                    Yêu cầu tính năng <ArrowRight size={13} />
                  </button>
                </div>
              </section>
            );
          }

          // ============ AUDIO STUDIO (Tách nhạc & lời) ============
          if (card.id === 'whisper') {
            const audioRes = labAudioResult;
            const langOptions = [
              { code: 'auto', label: 'Auto detect' },
              { code: 'vi', label: 'Tiếng Việt' },
              { code: 'en', label: 'English' },
              { code: 'zh', label: '中文' },
              { code: 'ja', label: '日本語' },
              { code: 'ko', label: '한국어' },
              { code: 'fr', label: 'Français' },
              { code: 'es', label: 'Español' }
            ];
            return (
              <section className={`forge-labws accent-${card.accent} forge-audio-ws`}>
                <header className="forge-labws-top">
                  <button type="button" className="forge-labws-back" onClick={backToLabGrid}>
                    <ArrowRight size={13} style={{ transform: 'rotate(180deg)' }} /> AI Lab
                  </button>
                  <div className="forge-labws-brand">
                    <div className="forge-labws-brand-icon"><Icon size={16} /></div>
                    <div>
                      <strong>{card.title}</strong>
                      <small>{card.tag}</small>
                    </div>
                  </div>
                  <div className="forge-audio-modes" role="tablist" aria-label="Mode">
                    <button type="button" className={labAudioMode === 'lyrics' ? 'active' : ''} onClick={() => { setLabAudioMode('lyrics'); if (!labAudioUrl.trim() && labStemsUrl.trim()) setLabAudioUrl(labStemsUrl); }}>
                      <FileText size={12} /> Trích lời
                    </button>
                    <button type="button" className={labAudioMode === 'stems' ? 'active' : ''} onClick={() => { setLabAudioMode('stems'); if (!labStemsUrl.trim() && labAudioUrl.trim()) setLabStemsUrl(labAudioUrl); }}>
                      <Layers size={12} /> Tách nhạc
                    </button>
                  </div>
                </header>

                {labAudioMode === 'lyrics' ? (
                  <div className="forge-audio-body">
                    {/* Left: input + waveform + transcript */}
                    <div className="forge-audio-main">
                      {/* URL input hero */}
                      <div className="forge-audio-input-card">
                        <div className="forge-audio-input-head">
                          <span className="forge-audio-input-icon"><Link2 size={16} /></span>
                          <div>
                            <strong>URL video / audio</strong>
                            <small>YouTube · TikTok · Vimeo · SoundCloud · Direct MP3/MP4 link</small>
                          </div>
                        </div>
                        <div className="forge-audio-input-row">
                          <Link2 size={14} />
                          <input
                            type="url"
                            placeholder="https://www.youtube.com/watch?v=..."
                            value={labAudioUrl}
                            onChange={(e) => setLabAudioUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && labAudioUrl.trim() && !labAudioBusy) runAudioWorkspace(); }}
                          />
                          {labAudioUrl ? (
                            <button type="button" className="forge-audio-input-clear" onClick={() => setLabAudioUrl('')} aria-label="Clear">
                              <XCircle size={13} />
                            </button>
                          ) : null}
                        </div>
                        <div className="forge-audio-input-examples">
                          <span>Thử với:</span>
                          <button type="button" onClick={() => setLabAudioUrl('https://www.youtube.com/watch?v=kffacxfA7G4')}>♪ Justin Bieber - Baby</button>
                          <button type="button" onClick={() => setLabAudioUrl('https://www.youtube.com/watch?v=YQHsXMglC9A')}>♪ Adele - Hello</button>
                          <button type="button" onClick={() => setLabAudioUrl('https://www.tiktok.com/@user/video/123')}>TikTok</button>
                        </div>
                      </div>

                      {/* Waveform visualizer */}
                      <div className="forge-audio-wave-card">
                        {audioRes?.video.thumbnail ? (
                          <div className="forge-audio-wave-thumb">
                            <img src={audioRes.video.thumbnail} alt={audioRes.video.title} />
                          </div>
                        ) : null}
                        <div className="forge-audio-wave-info">
                          {audioRes ? (
                            <>
                              <strong title={audioRes.video.title}>{audioRes.video.title}</strong>
                              <div className="forge-audio-wave-meta">
                                <span>{audioRes.video.host}</span>
                                <span>•</span>
                                <span>{audioRes.video.durationLabel}</span>
                                <span>•</span>
                                <span>{audioRes.languageLabel}</span>
                                {audioRes.source === 'whisper' ? <span className="forge-audio-tag wh">Whisper AI</span> : <span className="forge-audio-tag sub">Sub có sẵn</span>}
                              </div>
                            </>
                          ) : (
                            <>
                              <strong>Chưa có audio</strong>
                              <div className="forge-audio-wave-meta">
                                <span>Dán URL phía trên và bấm "Trích lời"</span>
                              </div>
                            </>
                          )}
                          {/* Waveform bars */}
                          <div className={`forge-audio-wave ${labAudioBusy ? 'is-busy' : ''} ${audioRes ? 'is-loaded' : ''}`}>
                            {Array.from({ length: 64 }).map((_, i) => {
                              const h = audioRes
                                ? 25 + Math.abs(Math.sin(i * 0.4) * 60) + (i % 5) * 4
                                : labAudioBusy
                                  ? 20 + Math.abs(Math.sin(i * 0.6 + Date.now() / 200) * 50)
                                  : 8 + (i % 4) * 4;
                              return <span key={i} style={{ height: `${Math.min(100, h)}%` }} />;
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Transcript output */}
                      {audioRes ? (
                        <div className="forge-audio-output">
                          <div className="forge-audio-output-head">
                            <div className="forge-audio-output-tabs" role="tablist">
                              <button type="button" className={labAudioView === 'segments' ? 'active' : ''} onClick={() => setLabAudioView('segments')}>
                                <Clock size={11} /> Timeline
                              </button>
                              <button type="button" className={labAudioView === 'plain' ? 'active' : ''} onClick={() => setLabAudioView('plain')}>
                                <FileText size={11} /> Plain text
                              </button>
                              <button type="button" className={labAudioView === 'markdown' ? 'active' : ''} onClick={() => setLabAudioView('markdown')}>
                                <FileType2 size={11} /> Markdown
                              </button>
                              <button type="button" className={labAudioView === 'srt' ? 'active' : ''} onClick={() => setLabAudioView('srt')}>
                                <Film size={11} /> SRT
                              </button>
                            </div>
                            <div className="forge-audio-output-actions">
                              {(() => {
                                const text =
                                  labAudioView === 'plain' ? audioRes.plainText :
                                  labAudioView === 'markdown' ? audioRes.paragraphsMarkdown :
                                  labAudioView === 'srt' ? audioRes.srt :
                                  audioRes.segments.map(s => `[${s.startLabel}] ${s.text}`).join('\n');
                                return (
                                  <>
                                    <button type="button" onClick={() => copyAudioField(text, labAudioView)}>
                                      {labAudioCopiedField === labAudioView ? <><ClipboardCheck size={11} /> Đã copy</> : <><Clipboard size={11} /> Copy</>}
                                    </button>
                                    <button type="button" onClick={() => {
                                      const safe = (audioRes.video.title || 'transcript').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
                                      const ext = labAudioView === 'srt' ? 'srt' : labAudioView === 'markdown' ? 'md' : 'txt';
                                      downloadAudioFile(`${safe}.${ext}`, text);
                                    }}>
                                      <Download size={11} /> Tải
                                    </button>
                                  </>
                                );
                              })()}
                            </div>
                          </div>

                          <div className="forge-audio-output-body">
                            {labAudioView === 'segments' ? (
                              <div className="forge-audio-segments">
                                {audioRes.segments.map((seg) => (
                                  <div key={seg.index} className="forge-audio-segment">
                                    <button
                                      type="button"
                                      className="forge-audio-seg-ts"
                                      onClick={() => copyAudioField(`[${seg.startLabel}] ${seg.text}`, `seg-${seg.index}`)}
                                      title="Copy dòng này"
                                    >
                                      {seg.startLabel}
                                    </button>
                                    <div className="forge-audio-seg-text">{seg.text}</div>
                                    {labAudioCopiedField === `seg-${seg.index}` ? (
                                      <span className="forge-audio-seg-copied"><CheckCircle2 size={11} /></span>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : labAudioView === 'plain' ? (
                              <pre className="forge-audio-plain">{audioRes.plainText}</pre>
                            ) : labAudioView === 'markdown' ? (
                              <pre className="forge-audio-plain">{audioRes.paragraphsMarkdown}</pre>
                            ) : (
                              <pre className="forge-audio-plain">{audioRes.srt}</pre>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Right: Controls */}
                    <aside className="forge-labws-panel">
                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title">Nguồn nội dung</div>
                        <div className="forge-audio-source-info">
                          <Link2 size={14} />
                          <div>
                            <strong>URL Video / Audio</strong>
                            <small>yt-dlp tải audio tự động · không cần upload</small>
                          </div>
                        </div>
                      </div>

                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title">Ngôn ngữ</div>
                        <div className="forge-audio-langs">
                          {langOptions.map((l) => (
                            <button
                              key={l.code}
                              type="button"
                              className={`forge-audio-lang ${labAudioLang === l.code ? 'active' : ''}`}
                              onClick={() => setLabAudioLang(l.code)}
                            >
                              {l.label}
                            </button>
                          ))}
                        </div>
                        <small className="forge-audio-lang-hint">Auto detect: ưu tiên sub có sẵn, fallback Whisper nếu không có.</small>
                      </div>

                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title">Engine</div>
                        <label className="forge-audio-toggle-row">
                          <input
                            type="checkbox"
                            checked={labAudioUseWhisper}
                            onChange={(e) => setLabAudioUseWhisper(e.target.checked)}
                          />
                          <div>
                            <strong>Whisper AI fallback</strong>
                            <small>Dùng AI local khi video không có sub. Chậm hơn nhưng accurate cho music.</small>
                          </div>
                        </label>
                        <div className="forge-audio-engine-flow">
                          <div className="forge-audio-engine-step"><span>1</span><strong>yt-dlp</strong><small>Sub có sẵn</small></div>
                          <ArrowRight size={11} />
                          <div className={`forge-audio-engine-step ${labAudioUseWhisper ? '' : 'disabled'}`}><span>2</span><strong>Whisper</strong><small>AI fallback</small></div>
                          <ArrowRight size={11} />
                          <div className="forge-audio-engine-step ok"><span>✓</span><strong>Output</strong><small>4 format</small></div>
                        </div>
                      </div>

                      <div className="forge-labws-section">
                        {labAudioError ? (
                          <div className="forge-labws-error">
                            <AlertTriangle size={13} /> {labAudioError}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="forge-labws-process"
                          disabled={!labAudioUrl.trim() || labAudioBusy}
                          onClick={runAudioWorkspace}
                        >
                          {labAudioBusy ? (
                            <><Loader2 size={15} className="forge-labws-spin" /> Đang trích lời…</>
                          ) : audioRes ? (
                            <><Mic size={15} /> Trích lại</>
                          ) : (
                            <><Mic size={15} /> Trích lời</>
                          )}
                        </button>
                        {audioRes ? (
                          <div className="forge-audio-result-stats">
                            <div><strong>{audioRes.segments.length}</strong><small>dòng</small></div>
                            <div><strong>{audioRes.video.durationLabel}</strong><small>thời lượng</small></div>
                            <div><strong>{audioRes.languageLabel.slice(0, 12)}</strong><small>ngôn ngữ</small></div>
                          </div>
                        ) : null}
                        {audioRes?.qualityWarning ? (
                          <div className="forge-labws-help warn" style={{ marginTop: 10 }}>
                            <AlertTriangle size={11} /> {audioRes.qualityWarning}
                          </div>
                        ) : null}
                      </div>

                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title"><Sparkles size={11} /> Pro tips</div>
                        <ul className="forge-labws-tips">
                          <li><CheckCircle2 size={11} /> Music video có sub karaoke: tự động parse tag &lt;c&gt;</li>
                          <li><CheckCircle2 size={11} /> Podcast 30+ phút: bật Whisper fallback</li>
                          <li><CheckCircle2 size={11} /> Output Markdown phù hợp đăng blog</li>
                          <li><CheckCircle2 size={11} /> SRT dùng cho video editor (Premiere, Davinci)</li>
                        </ul>
                      </div>
                    </aside>
                  </div>
                ) : (
                  /* STEMS MODE — Real Demucs separation + Web Audio mixer */
                  (() => {
                    const STEM_META: Record<string, { label: string; icon: string; color: string; desc: string }> = {
                      vocals: { label: 'Vocals', icon: '🎤', color: '#EF4444', desc: 'Giọng ca chính + backing' },
                      drums:  { label: 'Drums',  icon: '🥁', color: '#F59E0B', desc: 'Trống, hi-hat, cymbal' },
                      bass:   { label: 'Bass',   icon: '🎸', color: '#8B5CF6', desc: 'Bass guitar + sub-bass' },
                      other:  { label: 'Other',  icon: '🎹', color: '#0EA5E9', desc: 'Guitar, piano, synth, FX' }
                    };
                    const sr = labStemsResult;
                    const fmtTime = (s: number) => {
                      const m = Math.floor(s / 60);
                      const ss = Math.floor(s % 60);
                      return `${m}:${String(ss).padStart(2, '0')}`;
                    };
                    return (
                      <div className="forge-audio-stems">
                        {!sr ? (
                          <>
                            {/* Hero + input form */}
                            <div className="forge-audio-stems-hero">
                              <div className="forge-audio-stems-pill">
                                <Wand2 size={11} /> DEMUCS v4 · AI STEM SEPARATION
                              </div>
                              <h2>Tách 4 stems bằng AI</h2>
                              <p>
                                Demucs HTDemucs v4 (state-of-the-art) tách track nhạc thành 4 stems riêng biệt: <strong>Vocals</strong>, <strong>Drums</strong>, <strong>Bass</strong>, và <strong>Other</strong>.
                                Sẵn cho karaoke, remix, sampling, mashup, hoặc mix &amp; master lại.
                              </p>
                            </div>

                            <div className="forge-audio-input-card">
                              <div className="forge-audio-input-head">
                                <span className="forge-audio-input-icon" style={{ background: 'linear-gradient(135deg, #FB923C, #EA580C)', color: '#fff' }}>
                                  <Mic size={16} />
                                </span>
                                <div>
                                  <strong>URL audio / video</strong>
                                  <small>YouTube · SoundCloud · TikTok · Direct MP3 link · giới hạn 10 phút</small>
                                </div>
                              </div>
                              <div className="forge-audio-input-row">
                                <Link2 size={14} />
                                <input
                                  type="url"
                                  placeholder="https://www.youtube.com/watch?v=..."
                                  value={labStemsUrl}
                                  onChange={(e) => setLabStemsUrl(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && labStemsUrl.trim() && !labStemsBusy) runStemsSeparation(); }}
                                />
                                {labStemsUrl ? (
                                  <button type="button" className="forge-audio-input-clear" onClick={() => setLabStemsUrl('')} aria-label="Clear">
                                    <XCircle size={13} />
                                  </button>
                                ) : null}
                              </div>
                              <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
                                <button type="button" onClick={() => setLabStemsTwoMode(false)}
                                  style={{ flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                                    border: '1px solid ' + (!labStemsTwoMode ? '#0f9f8f' : 'rgba(127,127,127,.3)'),
                                    background: !labStemsTwoMode ? 'rgba(15,159,143,.12)' : 'transparent', color: 'inherit' }}>
                                  🎛️ 4 stems<br /><small style={{ opacity: 0.7, fontWeight: 400 }}>Vocals · Drums · Bass · Other</small>
                                </button>
                                <button type="button" onClick={() => setLabStemsTwoMode(true)}
                                  style={{ flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                                    border: '1px solid ' + (labStemsTwoMode ? '#0f9f8f' : 'rgba(127,127,127,.3)'),
                                    background: labStemsTwoMode ? 'rgba(15,159,143,.12)' : 'transparent', color: 'inherit' }}>
                                  🎤 2 stems (Karaoke)<br /><small style={{ opacity: 0.7, fontWeight: 400 }}>Giọng + Nhạc nền · nhanh ~2x</small>
                                </button>
                              </div>
                              <div className="forge-stems-model-picker">
                                <div className="forge-labws-section-title" style={{ marginBottom: 8 }}>Mô hình tách</div>
                                <div className="forge-stems-models">
                                  {([
                                    { id: 'htdemucs', label: 'HTDemucs', sub: 'Cân bằng nhanh + chất lượng', rec: true, time: '~3-5 min' },
                                    { id: 'htdemucs_ft', label: 'HTDemucs FT', sub: 'Fine-tuned, vocals tách sạch hơn', rec: false, time: '~5-8 min' },
                                    { id: 'mdx_extra', label: 'MDX Extra', sub: 'High-frequency clearer cho hi-hat', rec: false, time: '~5-7 min' }
                                  ] as const).map((m) => (
                                    <button
                                      key={m.id}
                                      type="button"
                                      className={`forge-stems-model ${labStemsModel === m.id ? 'active' : ''}`}
                                      onClick={() => setLabStemsModel(m.id as 'htdemucs' | 'htdemucs_ft' | 'mdx_extra')}
                                    >
                                      <strong>{m.label}{m.rec ? <em>khuyên dùng</em> : null}</strong>
                                      <small>{m.sub}</small>
                                      <span><Clock size={9} /> {m.time}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {labStemsError ? (
                                <div className="forge-labws-error">
                                  <AlertTriangle size={13} /> {labStemsError}
                                </div>
                              ) : null}

                              <button
                                type="button"
                                className="forge-stems-process"
                                disabled={!labStemsUrl.trim() || labStemsBusy}
                                onClick={runStemsSeparation}
                              >
                                {labStemsBusy ? (
                                  <><Loader2 size={15} className="forge-labws-spin" /> Đang tách… {labStemsElapsed > 0 ? `(${fmtTime(labStemsElapsed)})` : '(có thể vài phút)'}</>
                                ) : (
                                  <><Wand2 size={15} /> {labStemsTwoMode ? 'Tách Karaoke (2 stems)' : 'Tách 4 stems'}</>
                                )}
                              </button>

                              {labStemsBusy ? (
                                <div className="forge-stems-busy-pipeline">
                                  <div className="forge-stems-busy-step active"><span>1</span><div><strong>Tải audio</strong><small>yt-dlp đang lấy file WAV</small></div></div>
                                  <div className="forge-stems-busy-step active"><span>2</span><div><strong>Demucs AI</strong><small>Phân tích spectrogram + neural net</small></div></div>
                                  <div className="forge-stems-busy-step active"><span>3</span><div><strong>Export</strong><small>4 file MP3 + instrumental mix</small></div></div>
                                </div>
                              ) : null}
                            </div>

                            <div className="forge-audio-stems-tech">
                              <div className="forge-audio-stems-tech-block">
                                <div className="forge-labws-section-title"><Sparkles size={11} /> Lưu ý kỹ thuật</div>
                                <ul>
                                  <li><CheckCircle2 size={11} /> Server CPU mode — không cần GPU nhưng chậm hơn (~3-8 phút / bài 3-4 phút)</li>
                                  <li><CheckCircle2 size={11} /> Output MP3 256 kbps · 44.1 kHz · stereo</li>
                                  <li><CheckCircle2 size={11} /> Tự sinh instrumental track (drums + bass + other) cho karaoke</li>
                                  <li><CheckCircle2 size={11} /> Solo / mute / volume từng stem trong browser</li>
                                  <li><CheckCircle2 size={11} /> Giới hạn 10 phút audio để tránh OOM</li>
                                </ul>
                              </div>
                              <div className="forge-audio-stems-tech-block">
                                <div className="forge-labws-section-title"><Wand2 size={11} /> So sánh model</div>
                                <div className="forge-stems-compare">
                                  <div><strong>HTDemucs</strong><small>Default · 4 stems · best speed/quality</small></div>
                                  <div><strong>HTDemucs FT</strong><small>Fine-tuned · vocals cleaner · slower</small></div>
                                  <div><strong>MDX Extra</strong><small>MDX-Net · hi-freq detail · slower</small></div>
                                </div>
                                <small style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 8, display: 'block' }}>Demucs v4 (Meta AI 2023): state-of-the-art trên MUSDB18-HQ benchmark.</small>
                              </div>
                            </div>
                          </>
                        ) : (
                          /* Result: full mixer */
                          <>
                            <div className="forge-stems-result-head">
                              {sr.thumbnail ? (
                                <div className="forge-stems-thumb"><img src={sr.thumbnail} alt={sr.title} /></div>
                              ) : null}
                              <div className="forge-stems-result-meta">
                                <strong>{sr.title}</strong>
                                <div className="forge-stems-meta-row">
                                  <span><Clock size={11} /> {sr.durationLabel}</span>
                                  <span>•</span>
                                  <span>{sr.stems.length} stems</span>
                                  <span>•</span>
                                  <span className="forge-stems-model-tag">{sr.model}</span>
                                </div>
                                <div className="forge-stems-transport">
                                  <button type="button" className="forge-stems-play" onClick={toggleStemsPlay}>
                                    {labStemsPlaying ? (
                                      <>⏸ Pause</>
                                    ) : (
                                      <>▶ Play tất cả</>
                                    )}
                                  </button>
                                  <button type="button" className="forge-stems-stop" onClick={stopAllStems} title="Stop">⏹</button>
                                  <div className="forge-stems-time">
                                    {fmtTime(labStemsCurrentTime)} / {fmtTime(labStemsDuration)}
                                  </div>
                                  <input
                                    type="range"
                                    className="forge-stems-seek"
                                    min={0}
                                    max={labStemsDuration || 0}
                                    step={0.1}
                                    value={labStemsCurrentTime}
                                    onChange={(e) => seekStems(Number(e.target.value))}
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                className="forge-stems-new"
                                onClick={() => {
                                  stopAllStems();
                                  setLabStemsResult(null);
                                  setLabStemsUrl('');
                                }}
                              >
                                <UploadCloud size={12} /> Bài mới
                              </button>
                            </div>

                            <div className="forge-audio-stems-grid">
                              {sr.stems.map((stem: StemsStem) => {
                                const meta = STEM_META[stem.name] || { label: stem.label, icon: '🎵', color: '#94A3B8', desc: '' };
                                const muted = labStemsMuted[stem.name];
                                const isSoloed = labStemsSolo === stem.name;
                                const dimmed = labStemsSolo && labStemsSolo !== stem.name;
                                return (
                                  <div
                                    key={stem.name}
                                    className={`forge-audio-stem-card real ${muted ? 'is-muted' : ''} ${dimmed ? 'is-dimmed' : ''} ${isSoloed ? 'is-solo' : ''}`}
                                    style={{ borderTop: `3px solid ${meta.color}` }}
                                  >
                                    <audio
                                      ref={(el) => { labStemsAudioRefs.current[stem.name] = el; }}
                                      src={stem.streamUrl}
                                      preload="auto"
                                      onLoadedMetadata={(e) => {
                                        const a = e.currentTarget;
                                        a.volume = getStemEffectiveVolume(stem.name);
                                        if (stem.name === sr.stems[0]?.name && a.duration && !labStemsDuration) {
                                          setLabStemsDuration(a.duration);
                                        }
                                      }}
                                    />
                                    <div className="forge-audio-stem-head">
                                      <div className="forge-audio-stem-emoji" style={{ background: `${meta.color}22`, color: meta.color }}>{meta.icon}</div>
                                      <div>
                                        <strong>{meta.label}</strong>
                                        <small>{meta.desc}</small>
                                      </div>
                                      <div className="forge-audio-stem-actions">
                                        <button
                                          type="button"
                                          title="Solo"
                                          className={isSoloed ? 'on' : ''}
                                          onClick={() => toggleStemSolo(stem.name)}
                                        >S</button>
                                        <button
                                          type="button"
                                          title="Mute"
                                          className={muted ? 'on' : ''}
                                          onClick={() => toggleStemMute(stem.name)}
                                        >M</button>
                                      </div>
                                    </div>
                                    <div className="forge-audio-stem-wave" style={{ ['--stem-color' as never]: meta.color } as React.CSSProperties}>
                                      {Array.from({ length: 48 }).map((_, i) => {
                                        const h = 20 + Math.abs(Math.sin(i * 0.4 + stem.name.length) * 70);
                                        const progressPct = labStemsDuration > 0 ? labStemsProgress * 100 : 0;
                                        const barPct = (i / 48) * 100;
                                        const isPast = barPct < progressPct;
                                        return <span key={i} style={{ height: `${h}%`, opacity: isPast ? 1 : 0.45 }} />;
                                      })}
                                    </div>
                                    <div className="forge-audio-stem-foot">
                                      <div className="forge-audio-stem-volume">
                                        <span>Vol</span>
                                        <input
                                          type="range"
                                          min={0}
                                          max={100}
                                          value={labStemsVolumes[stem.name]}
                                          onChange={(e) => setStemVolume(stem.name, Number(e.target.value))}
                                        />
                                        <em>{labStemsVolumes[stem.name]}%</em>
                                      </div>
                                      <a
                                        href={stem.downloadUrl}
                                        download={stem.fileName}
                                        className="forge-audio-stem-download active"
                                      >
                                        <Download size={11} /> MP3 {formatBytes(stem.size)}
                                      </a>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {sr.instrumentalUrl ? (
                              <div className="forge-stems-karaoke">
                                <div className="forge-stems-karaoke-head">
                                  <div className="forge-stems-karaoke-icon">🎤</div>
                                  <div>
                                    <strong>Karaoke / Instrumental</strong>
                                    <small>Mix tự động (drums + bass + other) — không có vocals, hát theo được ngay</small>
                                  </div>
                                  <a href={sr.instrumentalUrl} download={`${sr.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_instrumental.mp3`} className="forge-stems-karaoke-dl">
                                    <Download size={13} /> Tải instrumental
                                  </a>
                                </div>
                              </div>
                            ) : null}

                            <div className="forge-stems-tips">
                              <div className="forge-labws-section-title"><Sparkles size={11} /> Workflow gợi ý</div>
                              <div className="forge-stems-tips-grid">
                                <div className="forge-stems-tip"><strong>🎤 Karaoke</strong><small>Mute Vocals → tải instrumental → hát theo / ghi vocal mới</small></div>
                                <div className="forge-stems-tip"><strong>🎧 Remix</strong><small>Solo Drums + Bass → loop làm beat backing track</small></div>
                                <div className="forge-stems-tip"><strong>🎵 Acapella</strong><small>Solo Vocals → download → mash up với beat khác</small></div>
                                <div className="forge-stems-tip"><strong>📚 Học</strong><small>Solo Bass / Other → cover guitar / piano dễ hơn</small></div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()
                )}
              </section>
            );
          }

          if (card.id === 'voice-clone') {
            const vcLangs: Array<{ id: string; label: string }> = [
              { id: 'en', label: 'English' }, { id: 'vi', label: 'Tiếng Việt (cần viXTTS)' },
              { id: 'es', label: 'Español' }, { id: 'fr', label: 'Français' },
              { id: 'de', label: 'Deutsch' }, { id: 'it', label: 'Italiano' },
              { id: 'pt', label: 'Português' }, { id: 'ja', label: '日本語' },
              { id: 'zh-cn', label: '中文' }, { id: 'ko', label: '한국어' }, { id: 'ru', label: 'Русский' }
            ];
            return (
              <section className={`forge-labws accent-${card.accent}`}>
                <header className="forge-labws-top">
                  <button type="button" className="forge-labws-back" onClick={backToLabGrid}>
                    <ArrowRight size={13} style={{ transform: 'rotate(180deg)' }} /> AI Lab
                  </button>
                  <div className="forge-labws-brand">
                    <div className="forge-labws-brand-icon"><Icon size={16} /></div>
                    <div><strong>{card.title}</strong><small>{card.tag}</small></div>
                  </div>
                  <div className="forge-labws-top-meta"><span><Clock size={11} /> {card.processTime}</span></div>
                </header>
                <div className="forge-labws-body" style={{ display: 'block', padding: '20px', maxWidth: 720, margin: '0 auto' }}>
                  {health && !health.voiceCloneReady ? (
                    <div className="forge-audio-empty" style={{ marginBottom: 16 }}>
                      ⚠️ Engine nhân bản giọng (Coqui XTTS) chưa được cài trên server. Tạo venv <code>.venv-tts</code> và <code>pip install coqui-tts</code> + torch.
                    </div>
                  ) : null}

                  <label className="forge-field-label" style={{ display: 'block', marginBottom: 6 }}>1. Giọng mẫu (audio 6-30s, càng sạch càng tốt)</label>
                  <input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setLabVcSample(f); setLabVcError(''); } }} style={{ marginBottom: 4 }} />
                  {labVcSample ? <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 14 }}>✓ {labVcSample.name}</div> : <div style={{ marginBottom: 14 }} />}

                  <label className="forge-field-label" style={{ display: 'block', marginBottom: 6 }}>2. Nội dung cần đọc (≤ 1000 ký tự)</label>
                  <textarea
                    value={labVcText}
                    maxLength={1000}
                    onChange={(e) => setLabVcText(e.target.value)}
                    placeholder="Nhập câu cần đọc bằng giọng đã clone..."
                    rows={4}
                    style={{ width: '100%', resize: 'vertical', marginBottom: 4, padding: 10, borderRadius: 8 }}
                  />
                  <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 14, textAlign: 'right' }}>{labVcText.length}/1000</div>

                  <label className="forge-field-label" style={{ display: 'block', marginBottom: 6 }}>3. Ngôn ngữ</label>
                  <select className="forge-select" value={labVcLang} onChange={(e) => setLabVcLang(e.target.value)} style={{ marginBottom: 18 }}>
                    {vcLangs.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                  {labVcLang === 'vi' && health && !health.vietnameseVoiceReady ? (
                    <div className="forge-audio-empty" style={{ marginBottom: 14 }}>
                      ℹ️ XTTS-v2 mặc định không hỗ trợ tiếng Việt. Cần tải model <strong>viXTTS</strong> vào <code>data/vixtts</code> (config.json + model.pth + vocab.json).
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="forge-btn-primary"
                    disabled={labVcBusy || !labVcSample || !labVcText.trim()}
                    onClick={runVoiceClone}
                    style={{ width: '100%', padding: '12px', fontSize: 15 }}
                  >
                    {labVcBusy ? '⏳ Đang tổng hợp (CPU, có thể 30-90s)...' : '🎙️ Nhân bản giọng & đọc'}
                  </button>

                  {labVcError ? <div className="forge-audio-empty" style={{ marginTop: 16, color: '#dc2626' }}>{labVcError}</div> : null}

                  {labVcResult ? (
                    <div style={{ marginTop: 20 }}>
                      <div className="forge-field-label" style={{ marginBottom: 8 }}>Kết quả</div>
                      <audio controls src={labVcResult.downloadUrl} style={{ width: '100%', marginBottom: 12 }} />
                      <DownloadList files={[labVcResult]} />
                    </div>
                  ) : null}
                </div>
              </section>
            );
          }

          // Active workspace
          const action = card.action;
          if (!action) return null;
          const toolId = action.tool;
          const hasResult = !!labWsResult;
          const canProcess = !!labWsFile && !labWsBusy;

          return (
            <section className={`forge-labws accent-${card.accent}`}>
              {/* Top bar */}
              <header className="forge-labws-top">
                <button type="button" className="forge-labws-back" onClick={backToLabGrid}>
                  <ArrowRight size={13} style={{ transform: 'rotate(180deg)' }} /> AI Lab
                </button>
                <div className="forge-labws-brand">
                  <div className="forge-labws-brand-icon"><Icon size={16} /></div>
                  <div>
                    <strong>{card.title}</strong>
                    <small>{card.tag}</small>
                  </div>
                </div>
                <div className="forge-labws-top-meta">
                  <span><Clock size={11} /> {card.processTime}</span>
                  <span><Layers size={11} /> {card.maxSize}</span>
                </div>
              </header>

              <div className="forge-labws-body">
                {/* Left: Canvas */}
                <div className="forge-labws-canvas">
                  {!labWsFile ? (
                    <div
                      className={`forge-labws-drop ${labWsDragging ? 'is-drag' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setLabWsDragging(true); }}
                      onDragLeave={() => setLabWsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setLabWsDragging(false);
                        const f = e.dataTransfer.files[0];
                        if (f) handleLabWsFile(f);
                      }}
                      onClick={() => labWsInputRef.current?.click()}
                      onPaste={(e) => {
                        const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
                        const f = item?.getAsFile();
                        if (f) handleLabWsFile(f);
                      }}
                      tabIndex={0}
                    >
                      <input
                        ref={labWsInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLabWsFile(f); }}
                      />
                      <div className={`forge-labws-drop-icon accent-${card.accent}`}>
                        <UploadCloud size={28} />
                      </div>
                      <strong>Thả ảnh vào đây</strong>
                      <span>hoặc click chọn từ máy · paste từ clipboard (Ctrl+V)</span>
                      <div className="forge-labws-drop-formats">
                        {card.formats.map((f) => <em key={f}>{f}</em>)}
                      </div>
                      <div className="forge-labws-drop-divider"><span>hoặc</span></div>
                      <button
                        type="button"
                        className="forge-labws-drop-sample"
                        onClick={(e) => { e.stopPropagation(); loadLabSample(toolId); }}
                      >
                        <Sparkles size={13} /> Thử với ảnh mẫu
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`forge-labws-canvas-stage bg-${labWsBg}`}
                      style={labWsBg === 'custom' ? { background: labWsBgCustom } : undefined}
                    >
                      {hasResult ? (
                        <div
                          className="forge-labws-compare"
                          onMouseMove={(e) => {
                            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                            const x = ((e.clientX - rect.left) / rect.width) * 100;
                            setLabWsComparePos(Math.max(0, Math.min(100, x)));
                          }}
                        >
                          <img src={labWsPreview} alt="Trước" className="forge-labws-compare-before" />
                          <div className="forge-labws-compare-after" style={{ clipPath: `inset(0 0 0 ${labWsComparePos}%)` }}>
                            <img src={labWsResult.downloadUrl} alt="Sau" />
                          </div>
                          <div className="forge-labws-compare-handle" style={{ left: `${labWsComparePos}%` }}>
                            <span><ChevronRight size={11} style={{ transform: 'rotate(180deg)' }} /><ChevronRight size={11} /></span>
                          </div>
                          <div className="forge-labws-compare-label left">TRƯỚC</div>
                          <div className="forge-labws-compare-label right">SAU</div>
                        </div>
                      ) : (
                        <div className="forge-labws-canvas-imgwrap">
                          <img
                            src={labWsPreview}
                            alt="Preview"
                            className="forge-labws-canvas-img"
                            ref={labInpaintImageRef}
                            onLoad={() => { if (toolId === 'remove-object') initInpaintCanvas(); }}
                          />
                          {toolId === 'remove-object' && labInpaintMode === 'subject' && labInpaintAutoMask ? (
                            <>
                              <img
                                src={labInpaintAutoMask}
                                alt="Detected subject"
                                className="forge-inpaint-auto-overlay"
                                aria-hidden="true"
                              />
                              <div className="forge-inpaint-detection-hint">
                                <Sparkles size={11} /> Vùng đỏ sẽ bị xoá khi bấm "Xoá vật thể"
                              </div>
                            </>
                          ) : null}
                          {toolId === 'remove-object' && labInpaintMode === 'smart' && labDetectResult ? (
                            <div className="forge-obj-overlay" aria-hidden="true">
                              {labDetectResult.objects.map((obj) => {
                                const removing = labRemoveIds.has(obj.id);
                                const [bx, by, bw, bh] = obj.bbox;
                                const left = (bx / labDetectResult.width) * 100;
                                const top = (by / labDetectResult.height) * 100;
                                const w = (bw / labDetectResult.width) * 100;
                                const h = (bh / labDetectResult.height) * 100;
                                return (
                                  <div
                                    key={obj.id}
                                    className={`forge-obj-bbox ${removing ? 'removing' : 'keeping'} ${labHoverObjId === obj.id ? 'hover' : ''}`}
                                    style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
                                  >
                                    <span className="forge-obj-bbox-label">
                                      {removing ? '✕' : '✓'} {obj.labelVi}
                                    </span>
                                  </div>
                                );
                              })}
                              <div className="forge-inpaint-detection-hint">
                                <Layers size={11} /> Đỏ = xoá · Xanh = giữ · click trong panel để đổi
                              </div>
                            </div>
                          ) : null}
                          {toolId === 'remove-object' && labInpaintMode === 'manual' ? (
                            <canvas
                              ref={labInpaintMaskCanvasRef}
                              className="forge-inpaint-canvas"
                              style={{
                                cursor: labInpaintTool === 'eraser'
                                  ? `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23047857" stroke-width="2"><circle cx="12" cy="12" r="${Math.max(4, labInpaintBrushSize / 8)}"/></svg>') 12 12, crosshair`
                                  : `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23f43f5e" stroke-width="2"><circle cx="12" cy="12" r="${Math.max(4, labInpaintBrushSize / 8)}"/></svg>') 12 12, crosshair`
                              }}
                              onMouseDown={(e) => {
                                labInpaintIsDrawingRef.current = true;
                                labInpaintLastPosRef.current = null;
                                const p = inpaintCanvasCoords(e);
                                if (p) inpaintDrawAt(p.x, p.y);
                              }}
                              onMouseMove={(e) => {
                                if (!labInpaintIsDrawingRef.current) return;
                                const p = inpaintCanvasCoords(e);
                                if (p) inpaintDrawAt(p.x, p.y);
                              }}
                              onMouseUp={() => {
                                labInpaintIsDrawingRef.current = false;
                                labInpaintLastPosRef.current = null;
                              }}
                              onMouseLeave={() => {
                                labInpaintIsDrawingRef.current = false;
                                labInpaintLastPosRef.current = null;
                              }}
                              onTouchStart={(e) => {
                                e.preventDefault();
                                labInpaintIsDrawingRef.current = true;
                                labInpaintLastPosRef.current = null;
                                const p = inpaintCanvasCoords(e);
                                if (p) inpaintDrawAt(p.x, p.y);
                              }}
                              onTouchMove={(e) => {
                                e.preventDefault();
                                if (!labInpaintIsDrawingRef.current) return;
                                const p = inpaintCanvasCoords(e);
                                if (p) inpaintDrawAt(p.x, p.y);
                              }}
                              onTouchEnd={() => {
                                labInpaintIsDrawingRef.current = false;
                                labInpaintLastPosRef.current = null;
                              }}
                            />
                          ) : null}
                          {toolId === 'crop-image' && labWsShowGrid && labWsSrcDims ? (
                            <div className="forge-labws-rot-grid" aria-hidden="true">
                              <span className="rot-v rot-v1" /><span className="rot-v rot-v2" />
                              <span className="rot-h rot-h1" /><span className="rot-h rot-h2" />
                            </div>
                          ) : null}
                          {toolId === 'crop-image' && labWsSrcDims ? (() => {
                            const aspectMap: Record<string, [number, number]> = {
                              'square': [1, 1], '4:3': [4, 3], '3:2': [3, 2],
                              '16:9': [16, 9], '9:16': [9, 16], '3:4': [3, 4], '2:3': [2, 3]
                            };
                            const aspect = String(labWsOptions.aspect ?? 'square');
                            const ratio = aspectMap[aspect];
                            if (!ratio) return null;
                            const [rw, rh] = ratio;
                            const srcAspect = labWsSrcDims.w / labWsSrcDims.h;
                            const tgtAspect = rw / rh;
                            // Compute % of source that the crop covers
                            let pctW: number, pctH: number;
                            if (tgtAspect > srcAspect) {
                              pctW = 100;
                              pctH = (srcAspect / tgtAspect) * 100;
                            } else {
                              pctH = 100;
                              pctW = (tgtAspect / srcAspect) * 100;
                            }
                            const left = (100 - pctW) / 2;
                            const top = (100 - pctH) / 2;
                            return (
                              <div
                                className="forge-labws-crop-overlay"
                                style={{
                                  left: `${left}%`,
                                  top: `${top}%`,
                                  width: `${pctW}%`,
                                  height: `${pctH}%`
                                }}
                                aria-hidden="true"
                              >
                                <span className="cop-corner tl" /><span className="cop-corner tr" />
                                <span className="cop-corner bl" /><span className="cop-corner br" />
                                <span className="cop-label">{aspect.toUpperCase()}</span>
                              </div>
                            );
                          })() : null}
                        </div>
                      )}
                      <div className="forge-labws-canvas-actions">
                        {hasResult ? (
                          <div className="forge-labws-bg-swap" role="group" aria-label="Nền hiển thị">
                            <button type="button" className={labWsBg === 'checker' ? 'active' : ''} onClick={() => setLabWsBg('checker')} title="Checkerboard">⊞</button>
                            <button type="button" className={labWsBg === 'white' ? 'active' : ''} onClick={() => setLabWsBg('white')} title="Trắng" style={{ background: '#fff' }}>　</button>
                            <button type="button" className={labWsBg === 'black' ? 'active' : ''} onClick={() => setLabWsBg('black')} title="Đen" style={{ background: '#000' }}>　</button>
                            <button type="button" className={labWsBg === 'emerald' ? 'active' : ''} onClick={() => setLabWsBg('emerald')} title="Emerald" style={{ background: '#047857' }}>　</button>
                          </div>
                        ) : (
                          <button type="button" className="forge-labws-canvas-change" onClick={() => labWsInputRef.current?.click()}>
                            <UploadCloud size={12} /> Đổi ảnh
                          </button>
                        )}
                        <input
                          ref={labWsInputRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLabWsFile(f); }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Controls */}
                <aside className="forge-labws-panel">
                  {/* Source inspector (after upload) */}
                  {labWsFile ? (
                    <div className="forge-labws-section forge-labws-inspector">
                      <div className="forge-labws-inspector-row">
                        <span className="forge-labws-inspector-label">FILE GỐC</span>
                        <button
                          type="button"
                          className="forge-labws-inspector-swap"
                          title="Đổi ảnh khác"
                          onClick={() => labWsInputRef.current?.click()}
                        >
                          <UploadCloud size={11} /> Đổi
                        </button>
                      </div>
                      <div className="forge-labws-inspector-name" title={labWsFile.name}>
                        {labWsFile.name}
                      </div>
                      <div className="forge-labws-inspector-stats">
                        <div>
                          <small>Kích thước</small>
                          <strong>{labWsSrcDims ? `${labWsSrcDims.w} × ${labWsSrcDims.h}` : '—'}</strong>
                        </div>
                        <div>
                          <small>Độ phân giải</small>
                          <strong>{labWsSrcDims ? megapixels(labWsSrcDims.w, labWsSrcDims.h) : '—'}</strong>
                        </div>
                        <div>
                          <small>Dung lượng</small>
                          <strong>{formatBytes(labWsFile.size)}</strong>
                        </div>
                        <div>
                          <small>Định dạng</small>
                          <strong>{(labWsFile.type.split('/')[1] || 'image').toUpperCase()}</strong>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Result inspector (after process) */}
                  {hasResult && labWsResult ? (
                    (() => {
                      const srcBytes = labWsFile?.size ?? 0;
                      const delta = srcBytes > 0 ? ((labWsResult.size - srcBytes) / srcBytes) * 100 : 0;
                      const savings = -delta;
                      const isLarger = labWsResult.size > srcBytes;
                      return (
                        <div className="forge-labws-section forge-labws-inspector forge-labws-inspector-result">
                          <div className="forge-labws-inspector-row">
                            <span className="forge-labws-inspector-label ok">
                              <CheckCircle2 size={11} /> KẾT QUẢ
                            </span>
                            <span className={`forge-labws-inspector-delta ${isLarger ? 'up' : 'down'}`}>
                              {isLarger ? '↑' : '↓'} {Math.abs(savings).toFixed(0)}%
                            </span>
                          </div>
                          <div className="forge-labws-inspector-name" title={labWsResult.fileName}>
                            {labWsResult.fileName}
                          </div>
                          <div className="forge-labws-inspector-stats">
                            <div>
                              <small>Kích thước mới</small>
                              <strong>{labWsResultDims ? `${labWsResultDims.w} × ${labWsResultDims.h}` : '—'}</strong>
                            </div>
                            <div>
                              <small>Độ phân giải</small>
                              <strong>{labWsResultDims ? megapixels(labWsResultDims.w, labWsResultDims.h) : '—'}</strong>
                            </div>
                            <div>
                              <small>Dung lượng</small>
                              <strong>{formatBytes(labWsResult.size)}</strong>
                            </div>
                            <div>
                              <small>{isLarger ? 'Tăng so với gốc' : 'Tiết kiệm'}</small>
                              <strong className={isLarger ? 'up' : 'down'}>{isLarger ? '+' : ''}{delta.toFixed(0)}%</strong>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : null}

                  {/* Tool-specific options */}
                  {toolId === 'remove-background' ? (
                    <>
                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title">Mô hình AI</div>
                        <div className="forge-labws-models">
                          {[
                            { id: 'u2net', label: 'U2Net', sub: 'Cân bằng, tổng quát', rec: true, time: '~3s' },
                            { id: 'isnet-general-use', label: 'IS-Net General', sub: 'Chất lượng cao, viền mịn', time: '~5s' },
                            { id: 'silueta', label: 'Silueta', sub: 'Tối ưu chân dung', time: '~3s' },
                            { id: 'isnet-anime', label: 'IS-Net Anime', sub: 'Ảnh vẽ / anime', time: '~5s' },
                            { id: 'u2netp', label: 'U2NetP', sub: 'Nhẹ, nhanh nhất', time: '~2s' }
                          ].map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              className={`forge-labws-model ${labWsOptions.model === m.id ? 'active' : ''}`}
                              onClick={() => setLabWsOption('model', m.id)}
                            >
                              <strong>{m.label}{m.rec ? <em>khuyên dùng</em> : null}</strong>
                              <small>{m.sub}</small>
                              <span className="forge-labws-model-time"><Clock size={9} /> {m.time}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Background replacement (visible after result) */}
                      {hasResult ? (
                        <div className="forge-labws-section">
                          <div className="forge-labws-section-title">Nền hiển thị</div>
                          <div className="forge-labws-bg-grid">
                            <button
                              type="button"
                              className={`forge-labws-bg-tile ${labWsBg === 'checker' ? 'active' : ''}`}
                              onClick={() => setLabWsBg('checker')}
                              title="Transparent (checker)"
                            >
                              <span className="forge-labws-bg-tile-vis checker" />
                              <small>Trong suốt</small>
                            </button>
                            <button
                              type="button"
                              className={`forge-labws-bg-tile ${labWsBg === 'white' ? 'active' : ''}`}
                              onClick={() => setLabWsBg('white')}
                            >
                              <span className="forge-labws-bg-tile-vis" style={{ background: '#fff', border: '1px solid #E5E7EB' }} />
                              <small>Trắng</small>
                            </button>
                            <button
                              type="button"
                              className={`forge-labws-bg-tile ${labWsBg === 'black' ? 'active' : ''}`}
                              onClick={() => setLabWsBg('black')}
                            >
                              <span className="forge-labws-bg-tile-vis" style={{ background: '#0F172A' }} />
                              <small>Đen</small>
                            </button>
                            <button
                              type="button"
                              className={`forge-labws-bg-tile ${labWsBg === 'emerald' ? 'active' : ''}`}
                              onClick={() => setLabWsBg('emerald')}
                            >
                              <span className="forge-labws-bg-tile-vis" style={{ background: '#047857' }} />
                              <small>Studio</small>
                            </button>
                            <button
                              type="button"
                              className={`forge-labws-bg-tile ${labWsBg === 'custom' ? 'active' : ''}`}
                              onClick={() => setLabWsBg('custom')}
                            >
                              <span className="forge-labws-bg-tile-vis" style={{ background: labWsBgCustom }} />
                              <small>Tuỳ chọn</small>
                            </button>
                          </div>
                          {labWsBg === 'custom' ? (
                            <div className="forge-labws-color-input" style={{ marginTop: 10 }}>
                              <input
                                type="color"
                                value={labWsBgCustom}
                                onChange={(e) => setLabWsBgCustom(e.target.value)}
                              />
                              <input
                                type="text"
                                value={labWsBgCustom}
                                onChange={(e) => setLabWsBgCustom(e.target.value)}
                              />
                            </div>
                          ) : null}
                          <div className="forge-labws-help">
                            <Sparkles size={11} /> File PNG kết quả có alpha — đặt lên bất kỳ background nào. Đây chỉ là preview.
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {toolId === 'upscale-image' ? (
                    (() => {
                      const scale = String(labWsOptions.scale ?? '2x');
                      const scaleN = scale === '4x' ? 4 : scale === '3x' ? 3 : 2;
                      const targetW = labWsSrcDims ? Math.min(6000, labWsSrcDims.w * scaleN) : 0;
                      const targetH = labWsSrcDims ? Math.round(targetW * (labWsSrcDims.h / Math.max(1, labWsSrcDims.w))) : 0;
                      const estBytes = labWsFile ? estimateUpscaledBytes(labWsFile.size, scaleN) : 0;
                      const willCap = labWsSrcDims ? (labWsSrcDims.w * scaleN > 6000) : false;
                      return (
                        <div className="forge-labws-section">
                          <div className="forge-labws-section-title">Tỉ lệ phóng</div>
                          <div className="forge-labws-scales">
                            {[
                              { id: '2x', label: '2×', sub: 'Đôi kích thước', rec: true },
                              { id: '3x', label: '3×', sub: 'Phóng vừa' },
                              { id: '4x', label: '4×', sub: 'Tối đa, cạnh ≤ 6000px' }
                            ].map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                className={`forge-labws-scale ${labWsOptions.scale === s.id ? 'active' : ''}`}
                                onClick={() => setLabWsOption('scale', s.id)}
                              >
                                <span className="forge-labws-scale-num">{s.label}</span>
                                <strong>{s.sub}</strong>
                                {s.rec ? <em>khuyên dùng</em> : null}
                              </button>
                            ))}
                          </div>

                          {labWsSrcDims ? (
                            <div className="forge-labws-upscale-preview">
                              <div className="forge-labws-upscale-arrow">
                                <div className="forge-labws-upscale-side">
                                  <small>TRƯỚC</small>
                                  <strong>{labWsSrcDims.w} × {labWsSrcDims.h}</strong>
                                  <span>{megapixels(labWsSrcDims.w, labWsSrcDims.h)} · {formatBytes(labWsFile?.size ?? 0)}</span>
                                </div>
                                <ArrowRight size={16} />
                                <div className="forge-labws-upscale-side ok">
                                  <small>SAU ({scale.toUpperCase()})</small>
                                  <strong>{targetW} × {targetH}</strong>
                                  <span>{megapixels(targetW, targetH)} · ~{formatBytes(estBytes)}</span>
                                </div>
                              </div>
                              {willCap ? (
                                <div className="forge-labws-help warn">
                                  <AlertTriangle size={11} /> Sẽ bị giới hạn ở 6000px cạnh dài. Output thực tế có thể nhỏ hơn {scaleN}×.
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="forge-labws-help">
                            <Sparkles size={11} /> Pipeline: Lanczos resampling + unsharp mask. Ảnh blur sẵn không thể "tạo" thêm chi tiết.
                          </div>
                        </div>
                      );
                    })()
                  ) : null}

                  {toolId === 'chroma-key' ? (
                    <div className="forge-labws-section">
                      <div className="forge-labws-section-title">Chọn màu nền</div>
                      <div className="forge-labws-chroma-targets">
                        {[
                          { id: 'auto', label: 'Auto detect', hint: 'Lấy màu trung bình 4 góc' },
                          { id: 'custom', label: 'Tự nhập HEX', hint: 'Pick chính xác' }
                        ].map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={`forge-labws-chroma-target ${(labWsOptions.target ?? 'auto') === t.id ? 'active' : ''}`}
                            onClick={() => setLabWsOption('target', t.id)}
                          >
                            <strong>{t.label}</strong>
                            <small>{t.hint}</small>
                          </button>
                        ))}
                      </div>
                      {labWsOptions.target === 'custom' ? (
                        <div className="forge-labws-field">
                          <label>
                            Mã màu HEX
                            <button
                              type="button"
                              className="forge-labws-eyedropper"
                              onClick={pickColorWithEyeDropper}
                              title="Pick màu từ màn hình"
                            >
                              <Sparkles size={10} /> EyeDropper
                            </button>
                          </label>
                          <div className="forge-labws-color-input">
                            <input
                              type="color"
                              value={String(labWsOptions.color ?? '#ffffff')}
                              onChange={(e) => setLabWsOption('color', e.target.value)}
                            />
                            <input
                              type="text"
                              value={String(labWsOptions.color ?? '#ffffff')}
                              onChange={(e) => setLabWsOption('color', e.target.value)}
                              placeholder="#ffffff"
                            />
                            <div className="forge-labws-color-swatches">
                              {['#ffffff', '#000000', '#22c55e', '#0066ff', '#FB923C', '#1e293b', '#fef3c7'].map((hex) => (
                                <button key={hex} type="button" onClick={() => setLabWsOption('color', hex)} style={{ background: hex }} title={hex} />
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="forge-labws-field">
                        <label>Dung sai màu <em>{labWsOptions.tolerance ?? 32}</em></label>
                        <input
                          type="range"
                          min={0}
                          max={120}
                          value={Number(labWsOptions.tolerance ?? 32)}
                          onChange={(e) => setLabWsOption('tolerance', Number(e.target.value))}
                        />
                        <small>Cao = ăn sâu vào subject. Thấp = sót viền</small>
                      </div>
                      <div className="forge-labws-field">
                        <label>Mềm cạnh (feather) <em>{labWsOptions.feather ?? 12}</em></label>
                        <input
                          type="range"
                          min={0}
                          max={60}
                          value={Number(labWsOptions.feather ?? 12)}
                          onChange={(e) => setLabWsOption('feather', Number(e.target.value))}
                        />
                        <small>Gradient alpha quanh viền, tránh răng cưa</small>
                      </div>
                    </div>
                  ) : null}

                  {toolId === 'crop-image' ? (
                    <div className="forge-labws-section">
                      <div className="forge-labws-section-title">Tỉ lệ crop</div>
                      <div className="forge-labws-ratios">
                        {[
                          { id: 'square', label: '1:1', sub: 'Instagram', w: 1, h: 1 },
                          { id: '16:9', label: '16:9', sub: 'YouTube', w: 16, h: 9 },
                          { id: '4:3', label: '4:3', sub: 'Sách', w: 4, h: 3 },
                          { id: '3:2', label: '3:2', sub: 'DSLR', w: 3, h: 2 },
                          { id: '9:16', label: '9:16', sub: 'Story', w: 9, h: 16 },
                          { id: '3:4', label: '3:4', sub: 'Portrait', w: 3, h: 4 }
                        ].map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            className={`forge-labws-ratio ${(labWsOptions.aspect ?? 'square') === r.id ? 'active' : ''}`}
                            onClick={() => setLabWsOption('aspect', r.id)}
                          >
                            <span className="forge-labws-ratio-vis" style={{ aspectRatio: `${r.w}/${r.h}` }} />
                            <strong>{r.label}</strong>
                            <small>{r.sub}</small>
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`forge-labws-ratio ${labWsOptions.aspect === 'custom' ? 'active' : ''}`}
                          onClick={() => setLabWsOption('aspect', 'custom')}
                        >
                          <span className="forge-labws-ratio-vis" style={{ aspectRatio: '1/1', border: '1.5px dashed currentColor', background: 'transparent' }} />
                          <strong>Custom</strong>
                          <small>Nhập W×H</small>
                        </button>
                      </div>
                      {labWsOptions.aspect === 'custom' ? (
                        <>
                          <div className="forge-labws-row2" style={{ marginTop: 10 }}>
                            <div className="forge-labws-field">
                              <label>Width (px)</label>
                              <input type="number" min={1} step={10} value={Number(labWsOptions.width ?? 1000)} onChange={(e) => setLabWsOption('width', Number(e.target.value))} />
                            </div>
                            <div className="forge-labws-field">
                              <label>Height (px)</label>
                              <input type="number" min={1} step={10} value={Number(labWsOptions.height ?? 1000)} onChange={(e) => setLabWsOption('height', Number(e.target.value))} />
                            </div>
                          </div>
                          <div className="forge-labws-row2">
                            <div className="forge-labws-field">
                              <label>Vị trí X</label>
                              <input type="number" min={0} step={10} value={Number(labWsOptions.x ?? 0)} onChange={(e) => setLabWsOption('x', Number(e.target.value))} />
                            </div>
                            <div className="forge-labws-field">
                              <label>Vị trí Y</label>
                              <input type="number" min={0} step={10} value={Number(labWsOptions.y ?? 0)} onChange={(e) => setLabWsOption('y', Number(e.target.value))} />
                            </div>
                          </div>
                        </>
                      ) : null}

                      {/* Live target preview */}
                      {labWsSrcDims && labWsOptions.aspect !== 'custom' ? (
                        (() => {
                          const aspectMap: Record<string, [number, number]> = {
                            'square': [1, 1], '4:3': [4, 3], '3:2': [3, 2],
                            '16:9': [16, 9], '9:16': [9, 16], '3:4': [3, 4], '2:3': [2, 3]
                          };
                          const aspect = String(labWsOptions.aspect ?? 'square');
                          const ratio = aspectMap[aspect];
                          if (!ratio) return null;
                          const [rw, rh] = ratio;
                          // Find max crop that fits inside source
                          const srcAspect = labWsSrcDims.w / labWsSrcDims.h;
                          const tgtAspect = rw / rh;
                          let cropW: number, cropH: number;
                          if (tgtAspect > srcAspect) {
                            cropW = labWsSrcDims.w;
                            cropH = Math.round(labWsSrcDims.w / tgtAspect);
                          } else {
                            cropH = labWsSrcDims.h;
                            cropW = Math.round(labWsSrcDims.h * tgtAspect);
                          }
                          return (
                            <div className="forge-labws-crop-preview">
                              <div className="forge-labws-crop-preview-row">
                                <span><small>Source</small><strong>{labWsSrcDims.w} × {labWsSrcDims.h}</strong></span>
                                <ArrowRight size={13} />
                                <span><small>Crop</small><strong>{cropW} × {cropH}</strong></span>
                              </div>
                              <small>Tự động chọn vùng lớn nhất giữ đúng tỉ lệ</small>
                            </div>
                          );
                        })()
                      ) : null}

                      <div className="forge-labws-field" style={{ marginTop: 10 }}>
                        <label>
                          Lưới rule-of-thirds
                          <button
                            type="button"
                            className={`forge-labws-toggle ${labWsShowGrid ? 'on' : ''}`}
                            onClick={() => setLabWsShowGrid(!labWsShowGrid)}
                          >
                            {labWsShowGrid ? 'ON' : 'OFF'}
                          </button>
                        </label>
                        <small>Overlay lưới 3×3 lên canvas để bố cục cân đối</small>
                      </div>
                    </div>
                  ) : null}

                  {toolId === 'scan-document' ? (
                    <div className="forge-labws-section">
                      <div className="forge-labws-section-title">Pipeline xử lý</div>
                      <ol className="forge-labws-pipeline">
                        <li><span>1</span><div><strong>Auto-rotate</strong><small>Theo EXIF orientation</small></div></li>
                        <li><span>2</span><div><strong>Grayscale</strong><small>Chuyển ảnh sang đen trắng</small></div></li>
                        <li><span>3</span><div><strong>CLAHE contrast</strong><small>Tăng tương phản adaptive</small></div></li>
                        <li><span>4</span><div><strong>Unsharp mask</strong><small>Sharpen ranh giới chữ</small></div></li>
                        <li><span>5</span><div><strong>Export PNG</strong><small>Lossless, sẵn cho OCR</small></div></li>
                      </ol>
                      <div className="forge-labws-help">
                        <Sparkles size={11} /> Tự động — không có options. Chỉ cần upload ảnh chụp giấy là chạy.
                      </div>
                    </div>
                  ) : null}

                  {toolId === 'remove-object' ? (
                    <>
                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title">Chế độ xoá</div>
                        <div className="forge-inpaint-modes">
                          <button
                            type="button"
                            className={`forge-inpaint-mode ${labInpaintMode === 'smart' ? 'active' : ''}`}
                            onClick={() => setLabInpaintMode('smart')}
                          >
                            <div className="forge-inpaint-mode-icon"><Layers size={16} /></div>
                            <div>
                              <strong>Thông minh (AI) <em className="forge-inpaint-mode-warn" style={{ background: 'rgba(4,120,87,.15)', color: '#047857' }}>Samsung-style</em></strong>
                              <small>Giữ chủ thể chính, tự phát hiện + xoá vật thể phụ (người, xe, đồ nền). Chọn được từng vật thể.</small>
                            </div>
                          </button>
                          <button
                            type="button"
                            className={`forge-inpaint-mode ${labInpaintMode === 'manual' ? 'active' : ''}`}
                            onClick={() => { setLabInpaintMode('manual'); setLabInpaintAutoMask(''); }}
                          >
                            <div className="forge-inpaint-mode-icon"><Wand2 size={16} /></div>
                            <div>
                              <strong>Thủ công (Brush)</strong>
                              <small>Vẽ vùng cần xoá bằng cọ — chính xác tuyệt đối cho mọi vật thể.</small>
                            </div>
                          </button>
                          <button
                            type="button"
                            className={`forge-inpaint-mode ${labInpaintMode === 'subject' ? 'active' : ''} ${!health?.rembgReady ? 'is-disabled' : ''}`}
                            onClick={() => { if (health?.rembgReady) { setLabInpaintMode('subject'); } }}
                            disabled={!health?.rembgReady}
                          >
                            <div className="forge-inpaint-mode-icon"><Eraser size={16} /></div>
                            <div>
                              <strong>Xoá chủ thể chính {!health?.rembgReady ? <em className="forge-inpaint-mode-warn">cần rembg</em> : null}</strong>
                              <small>Ngược lại: xoá nhân vật chính, giữ background. Hợp ảnh sản phẩm.</small>
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* SMART mode — YOLO object detection */}
                      {labInpaintMode === 'smart' ? (
                        <div className="forge-labws-section">
                          <div className="forge-labws-section-title">Phát hiện vật thể (YOLOv8)</div>
                          <button
                            type="button"
                            className="forge-inpaint-detect-btn"
                            onClick={detectInpaintObjects}
                            disabled={!labWsFile || labDetectBusy}
                          >
                            {labDetectBusy ? (
                              <><Loader2 size={14} className="forge-labws-spin" /> Đang quét vật thể…</>
                            ) : labDetectResult ? (
                              <><CheckCircle2 size={14} /> Quét lại</>
                            ) : (
                              <><Layers size={14} /> Quét vật thể trong ảnh</>
                            )}
                          </button>

                          {labDetectResult && labDetectResult.objects.length > 0 ? (
                            <div className="forge-obj-list">
                              <div className="forge-obj-list-head">
                                <span>{labDetectResult.objects.length} vật thể · chọn cái cần xoá</span>
                                <div className="forge-obj-list-actions">
                                  <button type="button" onClick={() => setLabRemoveIds(new Set(labDetectResult.objects.filter((o) => !o.isMain).map((o) => o.id)))}>Chỉ phụ</button>
                                  <button type="button" onClick={() => setLabRemoveIds(new Set(labDetectResult.objects.map((o) => o.id)))}>Tất cả</button>
                                  <button type="button" onClick={() => setLabRemoveIds(new Set())}>Bỏ chọn</button>
                                </div>
                              </div>
                              {labDetectResult.objects.map((obj) => {
                                const removing = labRemoveIds.has(obj.id);
                                return (
                                  <button
                                    key={obj.id}
                                    type="button"
                                    className={`forge-obj-item ${removing ? 'removing' : 'keeping'}`}
                                    onClick={() => toggleRemoveObject(obj.id)}
                                    onMouseEnter={() => setLabHoverObjId(obj.id)}
                                    onMouseLeave={() => setLabHoverObjId(null)}
                                  >
                                    <span className="forge-obj-check">
                                      {removing ? <Trash2 size={13} /> : <CheckCircle2 size={13} />}
                                    </span>
                                    <span className="forge-obj-info">
                                      <strong>{obj.labelVi}{obj.isMain ? <em className="forge-obj-main">CHỦ THỂ</em> : null}</strong>
                                      <small>{Math.round(obj.confidence * 100)}% · {obj.areaPct}% diện tích</small>
                                    </span>
                                    <span className="forge-obj-status">{removing ? 'XOÁ' : 'GIỮ'}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : labDetectResult ? (
                            <div className="forge-labws-help warn">
                              <AlertTriangle size={11} /> Không phát hiện vật thể rõ ràng. Thử <strong>Manual brush</strong> vẽ tay.
                            </div>
                          ) : (
                            <div className="forge-labws-help">
                              <Sparkles size={11} /> Bấm "Quét vật thể" — AI sẽ tìm tất cả người/xe/đồ vật, tự giữ chủ thể chính (xanh) và đánh dấu vật thể phụ để xoá (đỏ). Bạn tích chọn cái nào cần xoá.
                            </div>
                          )}
                        </div>
                      ) : null}

                      {/* SUBJECT mode — rembg remove main */}
                      {labInpaintMode === 'subject' ? (
                        <div className="forge-labws-section">
                          <div className="forge-labws-section-title">Xoá chủ thể chính (rembg)</div>
                          <button
                            type="button"
                            className="forge-inpaint-detect-btn"
                            onClick={detectInpaintSubject}
                            disabled={!labWsFile || labInpaintAutoBusy}
                          >
                            {labInpaintAutoBusy ? (
                              <><Loader2 size={14} className="forge-labws-spin" /> Đang phát hiện…</>
                            ) : labInpaintAutoMask ? (
                              <><CheckCircle2 size={14} /> Đã phát hiện · phát hiện lại</>
                            ) : (
                              <><Sparkles size={14} /> Phát hiện chủ thể</>
                            )}
                          </button>
                          <div className="forge-labws-help">
                            {labInpaintAutoMask
                              ? <><CheckCircle2 size={11} /> Vùng đỏ glow = chủ thể sẽ bị xoá. Bấm "Xoá vật thể".</>
                              : <><AlertTriangle size={11} /> Mode này xoá NHÂN VẬT CHÍNH (ngược với Thông minh). Hợp ảnh sản phẩm cần xoá người mẫu giữ phông.</>}
                          </div>
                        </div>
                      ) : null}

                      {/* MANUAL mode — brush */}
                      {labInpaintMode === 'manual' ? (
                        <div className="forge-labws-section">
                          <div className="forge-labws-section-title">Brush Tool</div>
                          <div className="forge-inpaint-tools">
                            <button type="button" className={`forge-inpaint-tool ${labInpaintTool === 'brush' ? 'active' : ''}`} onClick={() => setLabInpaintTool('brush')}>
                              <Palette size={13} /> Brush
                            </button>
                            <button type="button" className={`forge-inpaint-tool ${labInpaintTool === 'eraser' ? 'active' : ''}`} onClick={() => setLabInpaintTool('eraser')}>
                              <Eraser size={13} /> Eraser
                            </button>
                            <button type="button" className="forge-inpaint-tool danger" onClick={clearInpaintMask} disabled={!labInpaintHasStrokes}>
                              <Trash2 size={13} /> Clear
                            </button>
                          </div>
                          <div className="forge-labws-field">
                            <label>Kích thước cọ <em>{labInpaintBrushSize}</em></label>
                            <input type="range" min={10} max={100} value={labInpaintBrushSize} onChange={(e) => setLabInpaintBrushSize(Number(e.target.value))} />
                            <div className="forge-inpaint-brush-preview">
                              <span style={{ width: `${labInpaintBrushSize}px`, height: `${labInpaintBrushSize}px` }} />
                            </div>
                          </div>
                          <div className="forge-labws-help">
                            <Sparkles size={11} /> Bôi cọ đỏ lên vật thể cần xoá. Eraser để sửa. Vẽ sát object → fill tự nhiên nhất.
                          </div>
                        </div>
                      ) : null}

                      {/* SHARED engine + sliders */}
                      <div className="forge-labws-section">
                        <div className="forge-labws-field">
                          <label>Engine inpaint <small style={{ marginLeft: 'auto', color: '#94A3B8', fontWeight: 500, fontSize: 10.5 }}>auto chọn tốt nhất</small></label>
                          <div className="forge-inpaint-engines">
                            {[
                              { id: 'auto', label: 'Auto (LaMa)', sub: 'Sắc nét · giữ background · khuyên dùng', tier: 'best', time: '~10-30s' },
                              { id: 'ldm', label: 'AI LDM', sub: 'Generative · vùng lớn phức tạp', tier: 'best', time: '~40-90s' },
                              { id: 'lama', label: 'AI LaMa', sub: 'Deep learning · background', tier: 'high', time: '~10-30s' },
                              { id: 'telea', label: 'Telea', sub: 'cv2 · cực nhanh', tier: 'mid', time: '~2-3s' },
                              { id: 'ns', label: 'Navier-Stokes', sub: 'cv2 · mịn', tier: 'mid', time: '~2-3s' }
                            ].map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className={`forge-inpaint-engine tier-${m.tier} ${(labWsOptions.method ?? 'auto') === m.id ? 'active' : ''}`}
                                onClick={() => setLabWsOption('method', m.id)}
                              >
                                <div className="forge-inpaint-engine-head">
                                  <strong>{m.label}</strong>
                                  <span className={`forge-inpaint-engine-tier ${m.tier}`}>{m.tier === 'best' ? '★★★' : m.tier === 'high' ? '★★' : '★'}</span>
                                </div>
                                <small>{m.sub}</small>
                                <em>{m.time}</em>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="forge-labws-field">
                          <label>Mở rộng mask (dilate) <em>{labWsOptions.dilate ?? 12}px</em></label>
                          <input type="range" min={0} max={40} value={Number(labWsOptions.dilate ?? 12)} onChange={(e) => setLabWsOption('dilate', Number(e.target.value))} />
                          <small>Khuyên dùng 8–14px để ăn cả viền, bóng đổ và phần phản chiếu sát vật thể.</small>
                        </div>
                        <div className="forge-labws-field">
                          <label>Mềm mép (feather) <em>{labWsOptions.feather ?? 3}px</em></label>
                          <input type="range" min={0} max={40} value={Number(labWsOptions.feather ?? 3)} onChange={(e) => setLabWsOption('feather', Number(e.target.value))} />
                          <small>4–8px thường tự nhiên nhất; quá cao sẽ làm vùng vá bị mờ.</small>
                        </div>
                        <div className="forge-labws-section-title">Hậu kỳ chống vết</div>
                        <div className="forge-inpaint-method forge-inpaint-method-3">
                          {[
                            { key: 'removeShadow', label: 'Xóa bóng đổ', sub: 'Ăn thêm vùng tối bất thường quanh mask' },
                            { key: 'removeReflection', label: 'Xóa phản chiếu', sub: 'Ăn thêm glare/highlight trắng sát vật thể' },
                            { key: 'premium', label: 'Hậu kỳ cao cấp', sub: 'Match màu, grain, sharpness và diệt halo viền' }
                          ].map((item) => {
                            const active = String(labWsOptions[item.key] ?? 'true') !== 'false';
                            return (
                              <button
                                key={item.key}
                                type="button"
                                className={active ? 'active' : ''}
                                onClick={() => setLabWsOption(item.key, active ? 'false' : 'true')}
                              >
                                <strong>{item.label}</strong>
                                <small>{item.sub}</small>
                              </button>
                            );
                          })}
                        </div>
                        {((labWsOptions.method ?? 'auto') === 'ldm') ? (
                          <div className="forge-labws-field">
                            <label>LDM steps <em>{labWsOptions.ldmSteps ?? 35}</em></label>
                            <input type="range" min={10} max={50} value={Number(labWsOptions.ldmSteps ?? 35)} onChange={(e) => setLabWsOption('ldmSteps', Number(e.target.value))} />
                            <small>25 = cân bằng. 40+ = chất lượng cao hơn, chậm hơn.</small>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {toolId === 'strip-metadata' ? (
                    <>
                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title">Privacy Audit</div>
                        <div className="forge-labws-privacy">
                          <div className="forge-labws-privacy-score">
                            <div className="forge-labws-privacy-score-num">!</div>
                            <div>
                              <strong>Ảnh chưa được làm sạch</strong>
                              <small>{labWsFile ? 'Có thể chứa metadata nhạy cảm' : 'Upload ảnh để bắt đầu'}</small>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="forge-labws-section">
                        <div className="forge-labws-section-title">Metadata sẽ bị xoá</div>
                        <div className="forge-labws-meta-grid">
                          <div className="forge-labws-meta-item ok">
                            <div className="forge-labws-meta-head">
                              <strong>📍 GPS Location</strong>
                              <span className="forge-labws-meta-pill danger">Cao</span>
                            </div>
                            <small>Toạ độ chính xác lúc chụp · có thể lộ nhà / nơi làm việc</small>
                          </div>
                          <div className="forge-labws-meta-item ok">
                            <div className="forge-labws-meta-head">
                              <strong>📷 Camera Info</strong>
                              <span className="forge-labws-meta-pill warn">Trung</span>
                            </div>
                            <small>Model máy, ống kính, ISO, aperture, focal length</small>
                          </div>
                          <div className="forge-labws-meta-item ok">
                            <div className="forge-labws-meta-head">
                              <strong>🕐 Timestamp</strong>
                              <span className="forge-labws-meta-pill warn">Trung</span>
                            </div>
                            <small>Ngày giờ chụp · ngày sửa · timezone</small>
                          </div>
                          <div className="forge-labws-meta-item ok">
                            <div className="forge-labws-meta-head">
                              <strong>👤 Author / Copyright</strong>
                              <span className="forge-labws-meta-pill ok">Thấp</span>
                            </div>
                            <small>Tên tác giả · phần mềm chỉnh sửa · copyright</small>
                          </div>
                          <div className="forge-labws-meta-item ok">
                            <div className="forge-labws-meta-head">
                              <strong>🎨 Color Profile</strong>
                              <span className="forge-labws-meta-pill ok">Thấp</span>
                            </div>
                            <small>ICC profile, color space — giữ lại nếu cần in</small>
                          </div>
                          <div className="forge-labws-meta-item ok">
                            <div className="forge-labws-meta-head">
                              <strong>🏷️ Tags / Keywords</strong>
                              <span className="forge-labws-meta-pill ok">Thấp</span>
                            </div>
                            <small>IPTC tags, keywords, captions nhúng trong file</small>
                          </div>
                        </div>
                        <div className="forge-labws-help">
                          <ShieldCheck size={11} /> Pixel ảnh giữ nguyên 100% — chỉ xoá EXIF/IPTC/XMP container. An toàn cho mọi mạng xã hội.
                        </div>
                      </div>
                    </>
                  ) : null}

                  {/* Generic process panel */}
                  <div className="forge-labws-section">
                    {labWsError ? (
                      <div className="forge-labws-error">
                        <AlertTriangle size={13} /> {labWsError}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="forge-labws-process"
                      disabled={
                        !canProcess ||
                        (toolId === 'remove-object' && labInpaintMode === 'smart' && labRemoveIds.size === 0) ||
                        (toolId === 'remove-object' && labInpaintMode === 'subject' && !labInpaintAutoMask) ||
                        (toolId === 'remove-object' && labInpaintMode === 'manual' && !labInpaintHasStrokes)
                      }
                      onClick={toolId === 'remove-object' ? runInpaintWorkspace : runLabWorkspace}
                    >
                      {labWsBusy ? (
                        <><Loader2 size={15} className="forge-labws-spin" /> {toolId === 'remove-object' ? 'Đang xoá vật thể…' : 'Đang xử lý…'}</>
                      ) : hasResult ? (
                        <><Wand2 size={15} /> {toolId === 'remove-object' ? 'Xoá lại' : 'Xử lý lại'}</>
                      ) : toolId === 'remove-object' ? (
                        labInpaintMode === 'smart' && labRemoveIds.size === 0 ? (
                          <><Layers size={15} /> {labDetectResult ? 'Chọn vật thể cần xoá' : 'Quét vật thể trước'}</>
                        ) : labInpaintMode === 'subject' && !labInpaintAutoMask ? (
                          <><Sparkles size={15} /> Cần phát hiện chủ thể trước</>
                        ) : labInpaintMode === 'manual' && !labInpaintHasStrokes ? (
                          <><Sparkles size={15} /> Cần vẽ vùng cần xoá</>
                        ) : (
                          <><Wand2 size={15} /> {labInpaintMode === 'smart' ? `Xoá ${labRemoveIds.size} vật thể` : 'Xoá vật thể'}</>
                        )
                      ) : (
                        <><Wand2 size={15} /> {!labWsFile ? 'Cần upload ảnh' : `Chạy ${card.title}`}</>
                      )}
                    </button>
                    {hasResult ? (
                      <div className="forge-labws-result-actions">
                        <a className="forge-labws-download" href={labWsResult.downloadUrl} download={labWsResult.fileName}>
                          <Download size={14} /> Tải {labWsResult.fileName}
                          <em>{formatBytes(labWsResult.size)}</em>
                        </a>
                        <button type="button" className="forge-labws-reset" onClick={() => { resetLabWorkspace(); }}>
                          <UploadCloud size={12} /> Ảnh mới
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Tips */}
                  {card.tips.length > 0 ? (
                    <div className="forge-labws-section">
                      <div className="forge-labws-section-title"><Sparkles size={11} /> Tips</div>
                      <ul className="forge-labws-tips">
                        {card.tips.slice(0, 3).map((tip, i) => (
                          <li key={i}><CheckCircle2 size={11} /> {tip}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </aside>
              </div>
            </section>
          );
        })()
      ) : activeTool === 'lab' ? (
        (() => {
          const labCounts = {
            all: aiLabCards.length,
            image: aiLabCards.filter((c) => c.category === 'image').length,
            audio: aiLabCards.filter((c) => c.category === 'audio').length,
            document: aiLabCards.filter((c) => c.category === 'document').length,
            premium: aiLabCards.filter((c) => c.premium).length,
            soon: aiLabCards.filter((c) => !c.available).length
          };
          const labFiltered = aiLabCards
            .filter((c) => {
              if (labCategory === 'premium' && !c.premium) return false;
              if (labCategory === 'soon' && c.available) return false;
              if (labCategory !== 'all' && labCategory !== 'premium' && labCategory !== 'soon' && c.category !== labCategory) return false;
              if (labSearch.trim()) {
                const q = labSearch.trim().toLowerCase();
                const blob = `${c.title} ${c.description} ${c.tag} ${c.formats.join(' ')}`.toLowerCase();
                if (!blob.includes(q)) return false;
              }
              return true;
            })
            .sort((a, b) => {
              if (labSort === 'az') return a.title.localeCompare(b.title, 'vi');
              if (labSort === 'new') return (a.available === b.available ? 0 : a.available ? 1 : -1);
              // popular: available first, popular flag, then alphabetic
              if (a.available !== b.available) return a.available ? -1 : 1;
              if (!!a.popular !== !!b.popular) return a.popular ? -1 : 1;
              return a.title.localeCompare(b.title, 'vi');
            });
          const recentCards = labRecentIds
            .map((id) => aiLabCards.find((c) => c.id === id))
            .filter((c): c is AILabCard => !!c);
          const detail = labDetailId ? aiLabCards.find((c) => c.id === labDetailId) : null;
          const renderPreview = (card: AILabCard) => (
            card.preview === 'portrait' ? (
              <div className="lp-portrait">
                <div className="lp-portrait-head" />
                <div className="lp-portrait-shoulder" />
              </div>
            ) : card.preview === 'landscape' ? (
              <div className="lp-landscape">
                <div className="lp-mountain mtn1" />
                <div className="lp-mountain mtn2" />
                <div className="lp-sun" />
              </div>
            ) : card.preview === 'vintage' ? (
              <div className="lp-vintage">
                <div className="lp-vintage-head" />
                <div className="lp-vintage-shoulder" />
              </div>
            ) : card.preview === 'beach' ? (
              <div className="lp-beach">
                <div className="lp-beach-sky" />
                <div className="lp-beach-sun" />
                <div className="lp-palm">
                  <span /><span /><span />
                </div>
              </div>
            ) : card.preview === 'palette' ? (
              <div className="lp-palette">
                <span style={{ background: '#D1FAE5' }} />
                <span style={{ background: '#A7F3D0' }} />
                <span style={{ background: '#10B981' }} />
                <span style={{ background: '#047857' }} />
              </div>
            ) : card.preview === 'crop' ? (
              <div className="lp-crop">
                <span className="lp-crop-corner tl" />
                <span className="lp-crop-corner tr" />
                <span className="lp-crop-corner bl" />
                <span className="lp-crop-corner br" />
                <span className="lp-crop-h" />
                <span className="lp-crop-v" />
              </div>
            ) : card.preview === 'text' ? (
              <div className="lp-text">
                <div className="lp-text-quote">"Một bức ảnh chứa cảnh chuyển nghiệp với ánh nắng studio..."</div>
              </div>
            ) : card.preview === 'bilingual' ? (
              <div className="lp-bilingual">
                <div className="lp-line en">English text</div>
                <div className="lp-line vi">Văn bản tiếng Việt</div>
              </div>
            ) : card.preview === 'audiobars' ? (
              <div className="lp-audiobars">
                {[35, 55, 80, 65, 95, 50, 40, 70, 45, 60, 30].map((h, i) => (
                  <span key={i} style={{ height: `${h}%` }} />
                ))}
              </div>
            ) : card.preview === 'voicewave' ? (
              <div className="lp-voicewave">
                <span className="lp-voicewave-play"><PlayCircle size={16} /></span>
                <svg className="lp-voicewave-line" viewBox="0 0 120 24" preserveAspectRatio="none">
                  <path d="M0 12 Q10 4 20 12 T40 12 T60 12 T80 12 T100 12 T120 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
            ) : (
              <div className="lp-document">
                <span /><span /><span />
              </div>
            )
          );
          const iconFor = (icon: AILabCard['icon']) =>
            icon === 'eraser' ? Eraser :
            icon === 'palette' ? Palette :
            icon === 'zap' ? Zap :
            icon === 'scan' ? ScanLine :
            icon === 'languages' ? Languages :
            icon === 'mic' ? Mic :
            icon === 'wand' ? Wand2 :
            icon === 'volume' ? Volume2 :
            Image;
          return (
            <section className="forge-lab-section">
              <div className="forge-lab-hero">
                <span className="forge-lab-hero-eyebrow">PREMIUM SUITE</span>
                <h1 className="forge-lab-hero-title">Thư viện công cụ AI</h1>
                <p className="forge-lab-hero-sub">
                  Khám phá bộ sưu tập các công cụ xử lý hình ảnh và âm thanh tiên tiến nhất. Tất cả chạy local — không upload, miễn phí, không giới hạn.
                </p>
                <div className="forge-lab-hero-meta">
                  <span><Sparkles size={12} /> {labCounts.all} công cụ</span>
                  <span><ShieldCheck size={12} /> 100% Local</span>
                  <span><TrendingUp size={12} /> Free tier</span>
                </div>
              </div>

              {/* Toolbar */}
              <div className="forge-lab-toolbar">
                <div className="forge-lab-search">
                  <Search size={14} />
                  <input
                    type="search"
                    placeholder="Tìm tool AI (vd: xoá nền, transcript, OCR…)"
                    value={labSearch ?? ''}
                    onChange={(e) => setLabSearch(e.target.value)}
                  />
                  {labSearch ? (
                    <button type="button" className="forge-lab-search-clear" onClick={() => setLabSearch('')} aria-label="Clear">
                      <XCircle size={13} />
                    </button>
                  ) : null}
                </div>

                <div className="forge-lab-cats" role="tablist" aria-label="Category">
                  <button type="button" className={labCategory === 'all' ? 'active' : ''} onClick={() => setLabCategory('all')}>
                    Tất cả <em>{labCounts.all}</em>
                  </button>
                  <button type="button" className={labCategory === 'image' ? 'active' : ''} onClick={() => setLabCategory('image')}>
                    Ảnh <em>{labCounts.image}</em>
                  </button>
                  <button type="button" className={labCategory === 'audio' ? 'active' : ''} onClick={() => setLabCategory('audio')}>
                    Audio <em>{labCounts.audio}</em>
                  </button>
                  <button type="button" className={labCategory === 'document' ? 'active' : ''} onClick={() => setLabCategory('document')}>
                    Tài liệu <em>{labCounts.document}</em>
                  </button>
                  <button type="button" className={labCategory === 'premium' ? 'active' : ''} onClick={() => setLabCategory('premium')}>
                    Premium <em>{labCounts.premium}</em>
                  </button>
                  <button type="button" className={labCategory === 'soon' ? 'active' : ''} onClick={() => setLabCategory('soon')}>
                    Sắp ra <em>{labCounts.soon}</em>
                  </button>
                </div>

                <div className="forge-lab-sort">
                  <Filter size={13} />
                  <select value={labSort} onChange={(e) => setLabSort(e.target.value as typeof labSort)}>
                    <option value="popular">Phổ biến</option>
                    <option value="az">A → Z</option>
                    <option value="new">Mới ra</option>
                  </select>
                </div>
              </div>

              {/* Recently used (only when filter = all) */}
              {recentCards.length > 0 && labCategory === 'all' && !labSearch ? (
                <div className="forge-lab-recent">
                  <div className="forge-lab-recent-head">
                    <span><History size={13} /> Gần đây bạn đã dùng</span>
                    <button type="button" className="forge-lab-recent-clear" onClick={() => { setLabRecentIds([]); try { localStorage.removeItem('convert-url:lab-recent-v1'); } catch { /* */ } }}>
                      Xoá
                    </button>
                  </div>
                  <div className="forge-lab-recent-row">
                    {recentCards.map((card) => {
                      const Icon = iconFor(card.icon);
                      return (
                        <button key={card.id} type="button" className={`forge-lab-recent-pill accent-${card.accent}`} onClick={() => openLabCard(card)}>
                          <span className="forge-lab-recent-pill-icon"><Icon size={13} /></span>
                          <span>{card.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Cards grid */}
              {labFiltered.length === 0 ? (
                <div className="forge-lab-empty">
                  <Search size={32} />
                  <strong>Không tìm thấy công cụ phù hợp</strong>
                  <span>Thử bỏ bộ lọc hoặc tìm bằng từ khoá khác.</span>
                  <button type="button" className="forge-button" onClick={() => { setLabSearch(''); setLabCategory('all'); }}>
                    <XCircle size={13} /> Xoá bộ lọc
                  </button>
                </div>
              ) : (
                <div className="forge-lab-grid">
                  {labFiltered.map((card) => {
                    const Icon = iconFor(card.icon);
                    const handleClick = () => openLabCard(card);
                    return (
                      <div
                        key={card.id}
                        className={`forge-lab-card accent-${card.accent} ${card.available ? '' : 'is-soon'}`}
                        role="button"
                        tabIndex={0}
                        onClick={handleClick}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
                        title={card.description}
                      >
                        {card.premium ? <span className="forge-lab-premium-badge">PREMIUM</span> : null}
                        {card.popular && !card.premium ? <span className="forge-lab-popular-badge"><TrendingUp size={9} /> HOT</span> : null}
                        <div className="forge-lab-card-top">
                          <div className="forge-lab-card-icon"><Icon size={16} /></div>
                          <button
                            type="button"
                            className="forge-lab-card-info"
                            aria-label="Chi tiết"
                            title="Xem chi tiết"
                            onClick={(e) => { e.stopPropagation(); setLabDetailId(card.id); }}
                          >
                            <HelpCircle size={13} />
                          </button>
                        </div>
                        <h3 className="forge-lab-card-title">{card.title}</h3>
                        <div className={`forge-lab-preview preview-${card.preview}`} aria-hidden="true">
                          {renderPreview(card)}
                        </div>
                        <div className="forge-lab-card-meta">
                          <span className="forge-lab-card-meta-formats">
                            {card.formats.slice(0, 3).map((f) => <em key={f}>{f}</em>)}
                            {card.formats.length > 3 ? <em>+{card.formats.length - 3}</em> : null}
                          </span>
                          <span className="forge-lab-card-meta-time"><Clock size={10} /> {card.processTime}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="forge-lab-foot">
                <div className="forge-lab-foot-stats">
                  <div className="forge-lab-stat">
                    <div className="forge-lab-stat-icon emerald"><Sparkles size={16} /></div>
                    <div>
                      <strong>{aiLabCards.filter((c) => c.available).length}</strong>
                      <span>Sẵn sàng dùng</span>
                    </div>
                  </div>
                  <div className="forge-lab-stat">
                    <div className="forge-lab-stat-icon violet"><Wand2 size={16} /></div>
                    <div>
                      <strong>{aiLabCards.filter((c) => !c.available).length}</strong>
                      <span>Đang phát triển</span>
                    </div>
                  </div>
                  <div className="forge-lab-stat">
                    <div className="forge-lab-stat-icon peach"><ShieldCheck size={16} /></div>
                    <div>
                      <strong>100%</strong>
                      <span>Local · không upload</span>
                    </div>
                  </div>
                  <div className="forge-lab-stat">
                    <div className="forge-lab-stat-icon sky"><TrendingUp size={16} /></div>
                    <div>
                      <strong>Free</strong>
                      <span>Không giới hạn</span>
                    </div>
                  </div>
                </div>

                <div className="forge-lab-cta">
                  <div>
                    <strong>Cần một tính năng AI cụ thể?</strong>
                    <span>Ý tưởng hay đều cân nhắc — đặc biệt nếu chạy được local không cần GPU lớn.</span>
                  </div>
                  <button type="button" className="forge-button" onClick={() => {
                    setActiveTool('files');
                    pushToast({ variant: 'info', title: 'Đã có 28 công cụ', detail: 'Khám phá File Tools' });
                  }}>
                    Xem 28 công cụ <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              {/* Detail Modal */}
              {detail ? (
                <>
                  <div className="forge-lab-modal-backdrop" onClick={() => setLabDetailId(null)} />
                  <div className="forge-lab-modal" role="dialog" aria-labelledby="lab-detail-title" aria-modal="true">
                    <button type="button" className="forge-lab-modal-close" aria-label="Đóng" onClick={() => setLabDetailId(null)}>
                      <XCircle size={16} />
                    </button>
                    <div className={`forge-lab-modal-head accent-${detail.accent}`}>
                      <div className="forge-lab-modal-icon">
                        {(() => { const Icon = iconFor(detail.icon); return <Icon size={22} />; })()}
                      </div>
                      <div className="forge-lab-modal-head-text">
                        <div className="forge-lab-modal-tag">
                          {detail.tag}
                          {detail.premium ? <span className="forge-lab-modal-pill premium">PREMIUM</span> : null}
                          {detail.popular ? <span className="forge-lab-modal-pill hot"><TrendingUp size={10} /> HOT</span> : null}
                          {!detail.available ? <span className="forge-lab-modal-pill soon"><Clock size={10} /> {detail.comingSoon}</span> : null}
                        </div>
                        <h2 id="lab-detail-title">{detail.title}</h2>
                        <p>{detail.description}</p>
                      </div>
                    </div>

                    <div className="forge-lab-modal-body">
                      {detail.longDescription ? (
                        <p className="forge-lab-modal-long">{detail.longDescription}</p>
                      ) : null}

                      <div className="forge-lab-modal-stats">
                        <div>
                          <small>ĐỊNH DẠNG</small>
                          <div className="forge-lab-modal-formats">
                            {detail.formats.map((f) => <em key={f}>{f}</em>)}
                          </div>
                        </div>
                        <div>
                          <small>THỜI GIAN</small>
                          <strong><Clock size={12} /> {detail.processTime}</strong>
                        </div>
                        <div>
                          <small>GIỚI HẠN</small>
                          <strong><Layers size={12} /> {detail.maxSize}</strong>
                        </div>
                      </div>

                      {detail.tips.length > 0 ? (
                        <div className="forge-lab-modal-tips">
                          <div className="forge-lab-modal-section-title"><Sparkles size={12} /> Tips dùng tốt nhất</div>
                          <ul>
                            {detail.tips.map((tip, i) => <li key={i}><CheckCircle2 size={12} /> {tip}</li>)}
                          </ul>
                        </div>
                      ) : null}

                      {detail.relatedIds.length > 0 ? (
                        <div className="forge-lab-modal-related">
                          <div className="forge-lab-modal-section-title"><Workflow size={12} /> Có thể dùng kèm</div>
                          <div className="forge-lab-modal-related-grid">
                            {detail.relatedIds
                              .map((id) => aiLabCards.find((c) => c.id === id))
                              .filter((c): c is AILabCard => !!c)
                              .map((c) => {
                                const Icon = iconFor(c.icon);
                                return (
                                  <button key={c.id} type="button" className={`forge-lab-related accent-${c.accent}`} onClick={() => setLabDetailId(c.id)}>
                                    <Icon size={13} />
                                    <span>{c.title}</span>
                                    <ChevronRight size={11} />
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="forge-lab-modal-foot">
                      <button type="button" className="forge-lab-modal-cancel" onClick={() => setLabDetailId(null)}>
                        Đóng
                      </button>
                      {detail.available ? (
                        <button type="button" className="forge-lab-modal-primary" onClick={() => { setLabDetailId(null); openLabCard(detail); }}>
                          {detail.action?.label ?? 'Mở công cụ'} <ArrowRight size={13} />
                        </button>
                      ) : (
                        <button type="button" className="forge-lab-modal-primary disabled" disabled>
                          <Clock size={13} /> {detail.comingSoon ?? 'Sắp ra'}
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </section>
          );
        })()

      ) : activeTool === 'workflows' ? (
        <section className="forge-workflows-section">
          <div className="forge-media-hero" style={{ marginBottom: 32 }}>
            <span className="forge-eyebrow"><Workflow size={12} /> Workflows</span>
            <h1 className="forge-h1">
              Template <em>quy trình</em> sẵn — chạy 1 click
            </h1>
            <p className="forge-subhead">
              6 workflow phổ biến nhất, từ trích script YouTube tới đóng PDF hồ sơ. Mỗi template tự chọn đúng tool + format, bạn chỉ cần thả file hoặc dán link.
            </p>
          </div>

          <div className="forge-wf-grid">
            {workflowTemplates.map((tpl) => {
              const Icon =
                tpl.icon === 'youtube' ? PlayCircle :
                tpl.icon === 'image' ? Image :
                tpl.icon === 'mic' ? Mic :
                tpl.icon === 'film' ? Film :
                tpl.icon === 'fileType' ? FileType2 :
                Workflow;
              return (
                <div key={tpl.id} className={`forge-wf-card accent-${tpl.accent}`}>
                  <div className="forge-wf-card-head">
                    <div className="forge-wf-card-icon"><Icon size={22} /></div>
                    {tpl.badge ? <span className="forge-wf-card-badge">{tpl.badge}</span> : null}
                  </div>
                  <h3 className="forge-wf-card-title">{tpl.title}</h3>
                  <p className="forge-wf-card-sub">{tpl.subtitle}</p>
                  <p className="forge-wf-card-desc">{tpl.description}</p>
                  <ol className="forge-wf-steps">
                    {tpl.steps.map((step, idx) => (
                      <li key={idx}>
                        <span className="forge-wf-step-num">{idx + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <button type="button" className="forge-wf-cta" onClick={() => applyWorkflow(tpl)}>
                    {tpl.cta} <ArrowRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="forge-wf-hint">
            <Star size={14} />
            <span>Mỗi template tự chuyển tab đúng, chọn sẵn tool và format. Sau khi mở, bạn chỉ cần thả file hoặc dán link là chạy.</span>
          </div>
        </section>
      ) : activeTool === 'library' ? (
        (() => {
          function kindOf(entry: RecentEntry): 'image' | 'doc' | 'audio' {
            const t = entry.tool.toLowerCase();
            if (t.includes('image') || t.includes('photo') || t.includes('thumbnail') || t.includes('crop') || t.includes('chroma') || t.includes('background') || t.includes('scan') || t.includes('upscale') || t.includes('rotate') || t.includes('filter') || t.includes('metadata') || t.includes('compress') || t.includes('resize')) return 'image';
            if (t.includes('audio') || t.includes('mp3') || t.includes('whisper') || t.includes('voice')) return 'audio';
            return 'doc';
          }
          function colorTag(kind: 'image' | 'doc' | 'audio'): string {
            return kind === 'image' ? 'AI IMAGE' : kind === 'audio' ? 'AUDIO' : 'TÀI LIỆU';
          }
          const allTools = Array.from(new Set(recentEntries.map((e) => e.toolTitle))).sort();
          const filtered = recentEntries.filter((entry) => {
            if (libTab === 'shared' || libTab === 'presets') return false;
            const k = kindOf(entry);
            if (libKind !== 'all' && libKind !== k) return false;
            if (libTools.size > 0 && !libTools.has(entry.toolTitle)) return false;
            if (libRange !== 'all') {
              const now = Date.now();
              const span = libRange === 'today' ? 86400000 : libRange === '7d' ? 7 * 86400000 : 30 * 86400000;
              if (now - entry.createdAt > span) return false;
            }
            if (libSearch.trim()) {
              const q = libSearch.trim().toLowerCase();
              const blob = `${entry.toolTitle} ${entry.inputs.join(' ')} ${entry.files.map((f) => f.fileName).join(' ')}`.toLowerCase();
              if (!blob.includes(q)) return false;
            }
            return true;
          });
          const totalSize = recentEntries.reduce((sum, e) => sum + e.files.reduce((s, f) => s + (f.size || 0), 0), 0);
          return (
            <section className="forge-library-v2">
              <header className="forge-libv2-top">
                <div className="forge-libv2-search">
                  <Search size={14} />
                  <input
                    type="search"
                    placeholder="Tìm kiếm tài liệu..."
                    value={libSearch ?? ''}
                    onChange={(e) => setLibSearch(e.target.value)}
                  />
                </div>
                <nav className="forge-libv2-tabs" aria-label="Library tabs">
                  <button type="button" className={libTab === 'recent' ? 'active' : ''} onClick={() => setLibTab('recent')}>Gần đây</button>
                  <button type="button" className={libTab === 'shared' ? 'active' : ''} onClick={() => setLibTab('shared')}>Đã chia sẻ</button>
                  <button type="button" className={libTab === 'presets' ? 'active' : ''} onClick={() => setLibTab('presets')}>Cấu hình sẵn</button>
                </nav>
              </header>

              <div className="forge-libv2-body">
                <aside className="forge-libv2-filters">
                  <div className="forge-libv2-filter-title">Bộ lọc</div>

                  <div className="forge-libv2-filter">
                    <label>KHOẢNG THỜI GIAN</label>
                    <select value={libRange} onChange={(e) => setLibRange(e.target.value as typeof libRange)}>
                      <option value="all">Tất cả thời gian</option>
                      <option value="today">Hôm nay</option>
                      <option value="7d">7 ngày qua</option>
                      <option value="30d">30 ngày qua</option>
                    </select>
                  </div>

                  <div className="forge-libv2-filter">
                    <label>LOẠI TỆP</label>
                    <div className="forge-libv2-pills">
                      <button type="button" className={libKind === 'all' ? 'active' : ''} onClick={() => setLibKind('all')}>Tất cả</button>
                      <button type="button" className={libKind === 'image' ? 'active' : ''} onClick={() => setLibKind('image')}>Ảnh</button>
                      <button type="button" className={libKind === 'doc' ? 'active' : ''} onClick={() => setLibKind('doc')}>Tài liệu</button>
                      <button type="button" className={libKind === 'audio' ? 'active' : ''} onClick={() => setLibKind('audio')}>Audio</button>
                    </div>
                  </div>

                  <div className="forge-libv2-filter">
                    <label>CÔNG CỤ ĐÃ DÙNG</label>
                    <div className="forge-libv2-checks">
                      {allTools.length === 0 ? (
                        <small className="forge-libv2-checks-empty">Chưa có job nào</small>
                      ) : (
                        allTools.slice(0, 8).map((tool) => (
                          <label key={tool} className="forge-libv2-check">
                            <input
                              type="checkbox"
                              checked={libTools.has(tool)}
                              onChange={() => {
                                setLibTools((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(tool)) next.delete(tool); else next.add(tool);
                                  return next;
                                });
                              }}
                            />
                            <span>{tool}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  {(libKind !== 'all' || libTools.size > 0 || libRange !== 'all' || libSearch) ? (
                    <button
                      type="button"
                      className="forge-libv2-reset"
                      onClick={() => { setLibKind('all'); setLibTools(new Set()); setLibRange('all'); setLibSearch(''); }}
                    >
                      <XCircle size={12} /> Xoá bộ lọc
                    </button>
                  ) : null}

                  <div className="forge-libv2-mini-stats">
                    <div>
                      <strong>{recentEntries.length}</strong>
                      <small>Job đã lưu</small>
                    </div>
                    <div>
                      <strong>{recentEntries.reduce((sum, e) => sum + e.files.length, 0)}</strong>
                      <small>File kết quả</small>
                    </div>
                    <div>
                      <strong>{(totalSize / 1024 / 1024).toFixed(1)} MB</strong>
                      <small>Dung lượng</small>
                    </div>
                  </div>
                </aside>

                <main className="forge-libv2-main">
                  <div className="forge-libv2-mainhead">
                    <div>
                      <h1 className="forge-libv2-h1">Thư viện của bạn</h1>
                      <p className="forge-libv2-sub">Quản lý {recentEntries.length.toLocaleString('vi-VN')} tài sản đã được AI xử lý</p>
                    </div>
                    <div className="forge-libv2-actions">
                      {recentEntries.length > 0 ? (
                        <button type="button" className="forge-libv2-clear" onClick={clearRecent} title="Xoá toàn bộ">
                          <Trash2 size={13} /> Xoá tất cả
                        </button>
                      ) : null}
                      <div className="forge-libv2-viewtoggle" role="tablist" aria-label="View mode">
                        <button type="button" className={libView === 'grid' ? 'active' : ''} onClick={() => setLibView('grid')} aria-label="Grid">
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor"/><rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/><rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/><rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor"/></svg>
                        </button>
                        <button type="button" className={libView === 'list' ? 'active' : ''} onClick={() => setLibView('list')} aria-label="List">
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="2" rx="1" fill="currentColor"/><rect x="1" y="6" width="12" height="2" rx="1" fill="currentColor"/><rect x="1" y="10" width="12" height="2" rx="1" fill="currentColor"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {libTab === 'shared' ? (
                    <div className="forge-libv2-empty">
                      <Layers size={36} />
                      <strong>Chưa có tài liệu đã chia sẻ</strong>
                      <span>Tính năng share link đang được phát triển. Sắp có trong bản tới.</span>
                    </div>
                  ) : libTab === 'presets' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>
                      <div style={{ padding: 16, border: '1px solid rgba(127,127,127,.2)', borderRadius: 12 }}>
                        <div className="forge-field-label" style={{ marginBottom: 8 }}>Lưu cấu hình File Tools hiện tại</div>
                        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 10 }}>
                          Tool đang chọn: <strong>{fileTools.find((t) => t.id === selectedTool)?.title ?? selectedTool}</strong>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Tên preset (vd: WebP 1920 chất lượng cao)"
                            style={{ flex: 1, minWidth: 240, padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,.3)' }} />
                          <button type="button" onClick={saveCurrentPreset}
                            style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#0f9f8f', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>💾 Lưu preset</button>
                        </div>
                      </div>
                      {presets.length === 0 ? (
                        <div className="forge-libv2-empty">
                          <Workflow size={36} />
                          <strong>Chưa có preset</strong>
                          <span>Chọn tool + tuỳ chọn ở File Tools rồi quay lại đây lưu để tái dùng nhanh.</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {presets.map((p) => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: '1px solid rgba(127,127,127,.2)', borderRadius: 10 }}>
                              <div style={{ minWidth: 0 }}>
                                <strong style={{ display: 'block' }}>{p.name}</strong>
                                <small style={{ opacity: 0.65 }}>{p.toolTitle} · {Object.keys(p.options).length} tuỳ chọn</small>
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                                <button type="button" onClick={() => applyPreset(p)}
                                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #0f9f8f', background: 'transparent', color: '#0f9f8f', fontWeight: 600, cursor: 'pointer' }}>Áp dụng</button>
                                <button type="button" onClick={() => deletePreset(p.id)} title="Xoá" className="forge-icon-btn"><Trash2 size={15} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : recentEntries.length === 0 ? (
                    <div className="forge-libv2-empty">
                      <Archive size={36} />
                      <strong>Chưa có lịch sử</strong>
                      <span>Sau khi chuyển đổi file ở File Tools, job sẽ tự lưu vào đây.</span>
                      <button type="button" className="forge-button" onClick={() => setActiveTool('files')}>
                        <FileSpreadsheet size={13} /> Mở File Tools
                      </button>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="forge-libv2-empty">
                      <Search size={36} />
                      <strong>Không có kết quả</strong>
                      <span>Thử bỏ bớt bộ lọc hoặc tìm với từ khoá khác.</span>
                    </div>
                  ) : libView === 'grid' ? (
                    <div className="forge-libv2-grid">
                      {filtered.map((entry) => {
                        const k = kindOf(entry);
                        const firstName = entry.files[0]?.fileName || entry.toolTitle;
                        const shortName = firstName.length > 16 ? firstName.slice(0, 14) + '…' : firstName;
                        const dateStr = new Date(entry.createdAt).toLocaleDateString('vi-VN').replaceAll('/', '.');
                        return (
                          <button
                            key={entry.jobId}
                            type="button"
                            className={`forge-libv2-card kind-${k}`}
                            onClick={() => applyRecent(entry)}
                            title={`${entry.toolTitle} · ${relativeTime(entry.createdAt)}`}
                          >
                            <div className="forge-libv2-thumb">
                              {k === 'image' ? (
                                <div className="lp-portrait small">
                                  <div className="lp-portrait-head" />
                                  <div className="lp-portrait-shoulder" />
                                </div>
                              ) : k === 'audio' ? (
                                <div className="lp-audiobars small">
                                  {[40, 70, 95, 55, 80, 45, 65].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
                                </div>
                              ) : (
                                <div className="lp-document small">
                                  <span /><span /><span />
                                </div>
                              )}
                              <button
                                type="button"
                                className="forge-libv2-card-del"
                                onClick={(e) => { e.stopPropagation(); deleteRecent(entry.jobId); }}
                                aria-label="Xoá"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                            <div className="forge-libv2-card-body">
                              <div className="forge-libv2-card-name" title={firstName}>{shortName}</div>
                              <div className="forge-libv2-card-meta">
                                <span className="forge-libv2-card-date">{dateStr}</span>
                                <span className={`forge-libv2-card-tag tag-${k}`}>{colorTag(k)}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="forge-libv2-list">
                      {filtered.map((entry) => {
                        const k = kindOf(entry);
                        const firstName = entry.files[0]?.fileName || entry.toolTitle;
                        const dateStr = new Date(entry.createdAt).toLocaleDateString('vi-VN').replaceAll('/', '.');
                        return (
                          <div key={entry.jobId} className={`forge-libv2-row kind-${k}`}>
                            <div className={`forge-libv2-row-thumb tag-${k}`}>
                              {k === 'image' ? <Image size={14} /> : k === 'audio' ? <Mic size={14} /> : <FileText size={14} />}
                            </div>
                            <div className="forge-libv2-row-body">
                              <strong title={firstName}>{firstName}</strong>
                              <small>{entry.toolTitle} · {relativeTime(entry.createdAt)} · {entry.files.length} file</small>
                            </div>
                            <span className={`forge-libv2-card-tag tag-${k}`}>{colorTag(k)}</span>
                            <span className="forge-libv2-row-date">{dateStr}</span>
                            <div className="forge-libv2-row-actions">
                              <button type="button" onClick={() => applyRecent(entry)} title="Mở lại"><ArrowRight size={13} /></button>
                              <button type="button" onClick={() => deleteRecent(entry.jobId)} title="Xoá" className="danger"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </main>
              </div>
            </section>
          );
        })()

      ) : activeTool === 'cloudflare' ? (
        <section className="forge-files-section">
          <div className="forge-media-hero" style={{ marginBottom: 24 }}>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Globe size={22} /> Cloudflare Tunnel</h1>
            <p>Mở app ra Internet bằng 1 URL công khai miễn phí (chạy qua máy của bạn). Tắt là URL hết hiệu lực ngay.</p>
          </div>

          {tunnel && tunnel.installed === false ? (
            <div className="forge-audio-empty" style={{ marginBottom: 16 }}>
              ⚠️ Chưa cài <code>cloudflared</code> trên máy. Cài bằng: <code>winget install Cloudflare.cloudflared</code> rồi tải lại trang.
            </div>
          ) : null}

          <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 18, border: '1px solid rgba(127,127,127,.25)', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: tunnel?.running ? '#16a34a' : '#9ca3af', display: 'inline-block' }} />
                  <strong>{tunnel?.running ? 'Đang chạy' : 'Đã tắt'}</strong>
                  <small style={{ opacity: 0.6 }}>cổng nội bộ: {tunnel?.targetPort ?? '—'}</small>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {tunnel?.running ? (
                    <button type="button" disabled={tunnelBusy} onClick={doStopTunnel}
                      style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}>
                      Tắt tunnel
                    </button>
                  ) : (
                    <button type="button" disabled={tunnelBusy} onClick={doStartTunnel}
                      style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0f9f8f', color: '#fff', cursor: tunnelBusy ? 'wait' : 'pointer', fontWeight: 600 }}>
                      {tunnelBusy ? '⏳ Đang mở…' : '🌐 Mở public URL'}
                    </button>
                  )}
                  <button type="button" className="forge-icon-btn" onClick={refreshTunnel} disabled={tunnelBusy} title="Làm mới"><RefreshCw size={15} /></button>
                </div>
              </div>

              {tunnel?.running && tunnel.url ? (
                <div style={{ marginTop: 16 }}>
                  <div className="forge-field-label" style={{ marginBottom: 6 }}>URL công khai</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input readOnly value={tunnel.url} onFocus={(e) => e.currentTarget.select()}
                      style={{ flex: 1, minWidth: 260, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,.3)', fontFamily: 'monospace', fontSize: 13 }} />
                    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(tunnel.url!); setTunnelCopied(true); setTimeout(() => setTunnelCopied(false), 1500); } catch { /* ignore */ } }}
                      style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(127,127,127,.3)', background: 'transparent', cursor: 'pointer', fontWeight: 600 }}>
                      {tunnelCopied ? '✓ Đã copy' : 'Copy'}
                    </button>
                    <a href={tunnel.url} target="_blank" rel="noreferrer"
                      style={{ padding: '9px 16px', borderRadius: 8, background: '#0f9f8f', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Mở ↗</a>
                  </div>
                </div>
              ) : tunnel?.running && !tunnel.url ? (
                <div style={{ marginTop: 14, opacity: 0.7 }}>Đang chờ Cloudflare cấp URL…</div>
              ) : null}
            </div>

            <div className="forge-audio-empty">
              ℹ️ URL đổi mỗi lần mở (Quick Tunnel). Chỉ online khi máy bạn bật + app đang chạy. Ai có link đều dùng được — đừng chia sẻ nếu không muốn người khác xài tài nguyên máy bạn.
            </div>

            {tunnel?.recentLog?.length ? (
              <details>
                <summary style={{ cursor: 'pointer', opacity: 0.7 }}>Log cloudflared</summary>
                <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 11, background: '#0b0b0b', color: '#ddd', padding: 12, borderRadius: 8, marginTop: 8 }}>{tunnel.recentLog.join('\n')}</pre>
              </details>
            ) : null}
          </div>
        </section>

      ) : (
        <section className="forge-files-section">
          <div className="forge-media-hero" style={{ marginBottom: 24 }}>
            <span className="forge-eyebrow"><FileSpreadsheet size={12} /> File Tools</span>
            <h1 className="forge-h1">Chuyển đổi file <em>chuẩn xác</em></h1>
            <p className="forge-subhead">
              28 công cụ chuyển đổi — Excel, JSON, XML, CSV, ảnh, PDF, Word, AI background removal. Drag & drop nhiều file để batch.
            </p>
          </div>

          <div className="forge-files-layout">
            {/* LEFT RAIL — tool picker */}
            <aside className="forge-tool-rail">
              <div className="forge-tool-search">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Tìm trong tiện ích..."
                  value={toolSearch ?? ''}
                  onChange={(event) => setToolSearch(event.target.value)}
                  aria-label="Tìm tool"
                />
                {toolSearch ? (
                  <button type="button" className="forge-tool-search-clear" onClick={() => setToolSearch('')} aria-label="Xoá tìm kiếm">
                    <XCircle size={13} />
                  </button>
                ) : null}
              </div>

              <div className="forge-tool-groups">
                {toolGroups.map((group) => (
                  <button
                    type="button"
                    key={group.id}
                    className={`forge-tool-group-tab ${activeFileGroup === group.id ? 'active' : ''}`}
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
                    {group.title}
                    <small>{group.tools.length}</small>
                  </button>
                ))}
              </div>

              <div className="forge-tool-list">
                {visibleTools.length === 0 ? (
                  <div className="forge-tool-list-empty">
                    <Search size={18} />
                    Không có tool nào khớp "{toolSearch}".
                  </div>
                ) : visibleTools.map((tool) => {
                  const usable = canUseTool(tool);
                  const disabledReason = toolDisabledReason(tool);
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className={`forge-tool-row ${selectedTool === tool.id ? 'active' : ''}`}
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
                      <span className="forge-tool-icon-box">
                        {tool.badge === 'Docs' ? <FileText size={18} /> : tool.badge === 'Image' || tool.badge === 'Scan' || tool.badge === 'AI' ? <Image size={18} /> : <Database size={18} />}
                      </span>
                      <span className="forge-tool-info">
                        <strong>{tool.title}</strong>
                        <small>{disabledReason || tool.description}</small>
                      </span>
                      <em className="forge-tool-badge">{tool.badge}</em>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* RIGHT MAIN — upload + options + results */}
            <div className="forge-files-main">
              <form onSubmit={handleFileSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* UPLOAD CARD */}
                <div className="forge-card">
                  <div className="forge-card-head">
                    <div className="forge-card-title">
                      <strong>{currentTool.title}</strong>
                      <small>{currentTool.description}</small>
                    </div>
                    <em className="forge-tool-badge">{currentTool.badge}</em>
                  </div>
                  <div className="forge-card-body">
                    <div
                      className={`forge-upload-zone ${isDraggingFile ? 'dragging' : ''} ${selectedFiles.length ? 'has-file' : ''}`}
                      onDragOver={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
                      onDragLeave={() => setIsDraggingFile(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setIsDraggingFile(false);
                        selectUploadFiles(event.dataTransfer.files, 'append');
                      }}
                    >
                      {isScanTool ? (
                        <input
                          key="scan-input"
                          ref={fileInputRef}
                          id="fileInput"
                          className="sr-only-file"
                          type="file"
                          accept={currentTool.accept || 'image/*'}
                          capture="environment"
                          onChange={(event) => selectUploadFiles(event.target.files, 'append')}
                        />
                      ) : (
                        <input
                          key="multi-input"
                          ref={fileInputRef}
                          id="fileInput"
                          className="sr-only-file"
                          type="file"
                          multiple
                          accept={currentTool.accept || '*/*'}
                          onChange={(event) => selectUploadFiles(event.target.files, 'append')}
                        />
                      )}
                      <div className="forge-upload-icon" aria-hidden="true">
                        {isScanTool ? <Camera size={24} /> : <UploadCloud size={24} />}
                      </div>
                      <div className="forge-upload-title">
                        {selectedFiles.length === 0
                          ? (isScanTool ? 'Chụp tài liệu hoặc chọn ảnh scan' : 'Kéo thả file vào đây')
                          : selectedFiles.length === 1
                            ? selectedFiles[0].name
                            : `${selectedFiles.length} file đã sẵn sàng`}
                      </div>
                      <div className="forge-upload-subtitle">
                        {selectedFiles.length === 0
                          ? `Định dạng: ${currentTool.accept}${!isScanTool ? ' · chọn nhiều file để batch' : ''}`
                          : selectedFiles.length === 1
                            ? formatBytes(selectedFiles[0].size)
                            : `${formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))} tổng cộng`}
                      </div>
                      <div className="forge-upload-actions">
                        <button type="button" className="forge-button primary" onClick={() => fileInputRef.current?.click()}>
                          <UploadCloud size={14} />
                          {selectedFiles.length ? 'Thêm file' : 'Chọn file'}
                        </button>
                        {isScanTool ? (
                          <button type="button" className="forge-button" onClick={openCamera}>
                            <Camera size={14} /> Camera
                          </button>
                        ) : null}
                        {selectedFiles.length > 0 ? (
                          <button type="button" className="forge-button danger" onClick={clearUploadFiles}>
                            <XCircle size={14} /> Xoá hết
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {selectedFiles.length > 0 ? (
                      <ul className="forge-file-chips" style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
                        {selectedFiles.map((file, index) => (
                          <li key={`${file.name}-${index}`} className="forge-file-chip" title={file.name}>
                            <FileText size={13} />
                            <span className="chip-name">{file.name}</span>
                            <small>{formatBytes(file.size)}</small>
                            <button type="button" aria-label={`Bỏ file ${file.name}`} onClick={() => removeUploadFile(index)}>
                              <Trash2 size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>

                {/* OPTIONS PANEL */}
                {toolOptionSpec[currentTool.id] ? (
                  <div className="forge-options-card">
                    <details open>
                      <summary className="forge-options-summary">
                        <Settings2 size={16} />
                        <span>Tuỳ chọn nâng cao</span>
                        {Object.keys(optionValues).some((k) => optionValues[k] !== (toolOptionSpec[currentTool.id]?.find((f) => f.key === k)?.defaultValue)) ? <span className="forge-options-dot" /> : null}
                        <button type="button" className="forge-options-reset" onClick={(e) => { e.preventDefault(); e.stopPropagation(); resetOptions(); }}>
                          Mặc định
                        </button>
                      </summary>
                      <div className="forge-options-body">
                        {(toolOptionSpec[currentTool.id] || []).map((field) => {
                          const value = optionValues[field.key] ?? field.defaultValue;
                          if (field.type === 'range') {
                            const num = Number(value);
                            const fillPct = Math.round(((num - field.min) / Math.max(1, field.max - field.min)) * 100);
                            return (
                              <div key={field.key} className="forge-option-row">
                                <div className="forge-option-row-head">
                                  <span>{field.label}</span>
                                  <strong>{num.toLocaleString('vi-VN')}{field.suffix || ''}</strong>
                                </div>
                                <input
                                  type="range"
                                  min={field.min}
                                  max={field.max}
                                  step={field.step || 1}
                                  value={num}
                                  onChange={(e) => setOptionValue(field.key, Number(e.target.value))}
                                  style={{ ['--range-fill' as string]: `${fillPct}%` }}
                                />
                                {field.help ? <small>{field.help}</small> : null}
                              </div>
                            );
                          }
                          if (field.type === 'number') {
                            return (
                              <div key={field.key} className="forge-option-row">
                                <div className="forge-option-row-head">
                                  <span>{field.label}</span>
                                  <strong>{Number(value).toLocaleString('vi-VN')}{field.suffix || ''}</strong>
                                </div>
                                <input
                                  type="number"
                                  min={field.min}
                                  max={field.max}
                                  step={field.step || 1}
                                  value={Number(value)}
                                  onChange={(e) => setOptionValue(field.key, Number(e.target.value))}
                                />
                                {field.help ? <small>{field.help}</small> : null}
                              </div>
                            );
                          }
                          if (field.type === 'select') {
                            return (
                              <div key={field.key} className="forge-option-row">
                                <div className="forge-option-row-head"><span>{field.label}</span></div>
                                <select value={String(value)} onChange={(e) => setOptionValue(field.key, e.target.value)}>
                                  {field.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                </select>
                                {field.help ? <small>{field.help}</small> : null}
                              </div>
                            );
                          }
                          if (field.type === 'color') {
                            const colorVal = String(value);
                            return (
                              <div key={field.key} className="forge-option-row">
                                <div className="forge-option-row-head">
                                  <span>{field.label}</span>
                                  <strong>{colorVal.toUpperCase()}</strong>
                                </div>
                                <div className="forge-option-color">
                                  <input type="color" value={colorVal} onChange={(e) => setOptionValue(field.key, e.target.value)} />
                                  <input type="text" value={colorVal} onChange={(e) => setOptionValue(field.key, e.target.value)} placeholder="#ffffff" />
                                </div>
                                {field.help ? <small>{field.help}</small> : null}
                              </div>
                            );
                          }
                          if (field.type === 'text') {
                            return (
                              <div key={field.key} className="forge-option-row">
                                <div className="forge-option-row-head"><span>{field.label}</span></div>
                                <input type="text" value={String(value)} placeholder={field.placeholder} onChange={(e) => setOptionValue(field.key, e.target.value)} />
                                {field.help ? <small>{field.help}</small> : null}
                              </div>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </details>
                  </div>
                ) : null}

                {/* Dependency notices */}
                {currentTool.needsLibreOffice && !health?.libreOfficeReady ? (
                  <div className="forge-notice warning">
                    <AlertTriangle size={16} />
                    <span>Tool này cần <strong>LibreOffice</strong>. Cài local hoặc dùng Docker image.</span>
                  </div>
                ) : null}
                {currentTool.needsPdf2Docx && !health?.pdf2docxReady ? (
                  <div className="forge-notice warning">
                    <AlertTriangle size={16} />
                    <span>Tool này cần <strong>pdf2docx</strong>. Cài: <code>python -m pip install pdf2docx</code></span>
                  </div>
                ) : null}
                {currentTool.needsRembg && !health?.rembgReady ? (
                  <div className="forge-notice warning">
                    <AlertTriangle size={16} />
                    <span>Xoá nền AI cần <strong>rembg</strong>. Cài: <code>python -m pip install "rembg[cpu]"</code></span>
                  </div>
                ) : null}

                {/* CTA */}
                <button className="forge-cta" type="submit" disabled={fileBusy || !selectedFiles.length || !canUseTool(currentTool)}>
                  {fileBusy ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
                  {fileBusy
                    ? 'Đang chuyển đổi…'
                    : selectedFiles.length > 1
                      ? `Chạy ${currentTool.title} cho ${selectedFiles.length} file`
                      : `Chạy ${currentTool.title}`}
                </button>

                {fileMessage && fileMessage !== currentTool.description ? (
                  <div className={`forge-notice ${fileError ? 'danger' : 'info'}`}>
                    {fileError ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                    <span>{fileMessage}</span>
                  </div>
                ) : null}
              </form>

              {/* RESULTS */}
              {fileResults.length > 0 ? (
                <div className="forge-card">
                  <div className="forge-card-head">
                    <div className="forge-card-title">
                      <strong>Kết quả</strong>
                      <small>{fileResults.length} file đã chuyển đổi</small>
                    </div>
                    {fileResults.length > 1 && fileJobId ? (
                      <a
                        className="forge-zip-cta"
                        href={zipUrl(fileJobId, fileResults.map((f) => f.fileName))}
                        download={`convert-${fileJobId.slice(0, 8)}.zip`}
                        style={{ padding: '8px 14px', fontSize: 12 }}
                      >
                        <Archive size={14} /> Tải ZIP
                      </a>
                    ) : null}
                  </div>
                  <div className="forge-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {fileItems && fileItems.length > 1 ? (
                      fileItems.map((item, idx) => (
                        <div key={`${item.input}-${idx}`} className={`forge-result-card ${item.error ? 'has-error' : ''}`}>
                          <div className="forge-result-icon">
                            {item.error ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
                          </div>
                          <div className="forge-result-info">
                            <strong>{item.input}</strong>
                            <small>{item.error ? item.error : `${item.files?.length || 0} file output`}</small>
                          </div>
                          <div className="forge-result-actions">
                            {item.files?.map((f) => (
                              <a key={f.downloadUrl} className="forge-download-btn primary" href={f.downloadUrl} download={f.fileName}>
                                <Download size={12} />
                              </a>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      fileResults.map((file) => (
                        <div className="forge-result-card" key={file.downloadUrl}>
                          <div className="forge-result-icon"><CheckCircle2 size={20} /></div>
                          <div className="forge-result-info">
                            <strong>{file.fileName}</strong>
                            <small>{formatBytes(file.size)}</small>
                          </div>
                          <div className="forge-result-actions">
                            <a className="forge-download-btn" href={file.downloadUrl} target="_blank" rel="noreferrer">Mở</a>
                            <a className="forge-download-btn primary" href={file.downloadUrl} download={file.fileName}>
                              <Download size={12} /> Tải
                            </a>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {fileResults.length > 0 ? (
                <ResultPreview files={fileResults} />
              ) : null}

              {recentEntries.length > 0 ? (
                <RecentJobsPanel entries={recentEntries} onPick={applyRecent} onClear={clearRecent} />
              ) : null}
            </div>
          </div>
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
          </div>
        </div>
      </div>
    </div>
  );
}
