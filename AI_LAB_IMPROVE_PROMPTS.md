# 🔧 AI LAB — PROMPT CẢI THIỆN TỪNG CHỨC NĂNG
# Mỗi prompt dùng độc lập, paste thẳng vào Claude Code

---

## ══════════════════════════════════════════════════════
## PROMPT 1 — AI IMAGE UPSCALER (Nâng cấp độ phân giải)
## ══════════════════════════════════════════════════════

```
Hãy đọc toàn bộ code hiện tại của tính năng AI Image Upscaler trong dự án này 
(tìm theo từ khóa: upscal, upscaler, nâng cấp độ phân giải).
Phân tích kỹ rồi cải thiện TOÀN DIỆN cả Frontend lẫn Backend theo tiêu chí sau:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — UX/UI & TRẢI NGHIỆM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] UPLOAD ZONE — phải đạt chuẩn:
• Drag & drop mượt mà, có visual feedback rõ ràng khi đang kéo file vào (border pulse, màu highlight)
• Hiển thị đủ metadata ngay sau khi chọn file: tên file, kích thước (MB), độ phân giải gốc (WxH px), định dạng, ngày chụp (EXIF nếu có)
• Preview thumbnail chất lượng cao, có thể click để xem full-size trong modal lightbox
• Validate ngay phía client: sai định dạng/quá dung lượng → hiển thị lỗi inline (không dùng alert/toast), có icon cảnh báo màu đỏ và text giải thích rõ lý do

[2] SETTINGS PANEL — phải đủ tiện ích:
• Scale factor (2x/4x/8x): hiển thị preview kích thước OUTPUT ngay khi chọn
  → vd: "4x → 3840 × 2160 px (~14.7 MP) | Dung lượng ước tính: ~8.2 MB"
• AI Model selector: mỗi option có tooltip giải thích khi nào nên dùng
  → General, Face Enhancement, Photo Realism, Document/Text
• Advanced settings trong Accordion (mặc định đóng):
  - Denoise strength: slider 0–10, có label mô tả (Nhẹ / Vừa / Mạnh)
  - Sharpening post-process: toggle + slider intensity
  - Output format: PNG / JPEG / WEBP với quality slider (chỉ hiện khi JPEG/WEBP)
  - Color profile: sRGB / Adobe RGB / Giữ nguyên gốc
• Nút "Đặt Lại Mặc Định" cho settings panel

[3] BEFORE/AFTER COMPARISON — bắt buộc có đủ:
• Slider kéo giữa 2 ảnh (clip-path technique, KHÔNG dùng 2 ảnh đặt cạnh nhau)
• Label nổi bật: "GỐC: 800×600px" | "MỚI: 3200×2400px"
• Nút toggle chế độ: [So sánh kéo | Xem gốc | Xem kết quả | Nhấp để chuyển]
• Zoom lens: khi hover hiện magnifier 2x tại vị trí chuột, áp dụng cả 2 phía
• Bàn phím: arrow keys điều chỉnh slider, phím Z toggle zoom

[4] PROGRESS EXPERIENCE:
• KHÔNG dùng spinner đơn thuần — dùng step indicator có icon:
  Step 1 "Đang tải ảnh lên..." → Step 2 "Phân tích nội dung..." → Step 3 "Áp dụng AI Super Resolution..." → Step 4 "Tối ưu hóa màu sắc..." → Step 5 "Hoàn thành"
• Progress bar có animation smooth (CSS transition, không giật)
• Hiển thị thời gian đã qua + ước tính còn lại (dựa vào % progress)
• Nút "Hủy" có confirm dialog

[5] KẾT QUẢ & DOWNLOAD:
• Bảng thống kê so sánh rõ ràng: Độ phân giải | Dung lượng | Megapixels | Tỉ lệ nén
• Download button nổi bật, tên file tự động: {tên_gốc}_4x_upscaled.png
• Nút "Upscale Lại Với Cài Đặt Khác" (giữ ảnh gốc, reset settings)
• Nút "Copy Link" share kết quả (copy URL tạm thời)
• Auto-download sau 3s nếu user không tương tác (có thể tắt trong settings)

[6] RESPONSIVE & A11Y:
• Mobile: layout chuyển thành 1 cột dọc, touch-friendly slider
• Keyboard navigation đầy đủ (Tab order logic, Enter để submit)
• ARIA labels cho tất cả interactive elements
• Loading state không block keyboard

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND — NGHIỆP VỤ & HIỆU SUẤT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[7] VALIDATION & SECURITY:
• Validate magic bytes (đọc file header, không chỉ tin vào extension)
• Giới hạn: PNG/JPG/WEBP max 20MB, max 8000×8000px input (tránh OOM)
• Sanitize filename trước khi lưu (loại bỏ ký tự đặc biệt, path traversal)
• Rate limiting: max 10 requests/user/giờ (trả về 429 với Retry-After header)
• File cleanup: job files tự xóa sau 24h (@Scheduled)

[8] PROCESSING PIPELINE:
• Async processing bắt buộc: nhận file → trả về jobId ngay (202 Accepted)
• Polling endpoint GET /status/{jobId} trả về: { status, progress (0–100), currentStep, estimatedSecondsRemaining }
• Nếu có Python AI service: gọi qua RestTemplate với timeout 120s, retry 2 lần
• Nếu KHÔNG có Python service: fallback dùng Thumbnailator/Imgscalr với Bicubic interpolation + Unsharp Masking
• Xử lý ảnh lớn (>5MB): chia tile 512×512, xử lý song song, ghép lại (tránh OOM)

[9] RESPONSE CONTRACT — chuẩn hóa:
• Success: { success:true, data:{ jobId, outputUrl, originalWidth, originalHeight, newWidth, newHeight, originalSizeBytes, newSizeBytes, processingTimeMs, model, scaleFactor } }
• Error: { success:false, error:{ code:"FILE_TOO_LARGE", message:"File vượt quá 20MB", details:{maxSizeMb:20, actualSizeMb:25.3} } }
• Tất cả lỗi có error code cụ thể (không chỉ message string)

[10] LOGGING & MONITORING:
• Log đủ: userId, jobId, file size, scale, model, processingTime, success/fail
• Metric: đếm usage theo tool/user/ngày lưu vào bảng ai_lab_usage_stats
• Alert nếu error rate > 20% trong 5 phút

━━━━━━━━━━
YÊU CẦU CHUNG
━━━━━━━━━━
• Giữ nguyên tất cả code hiện tại không liên quan, KHÔNG refactor ngoài phạm vi tool này
• Tất cả text hiển thị bằng tiếng Việt
• Comments code bằng tiếng Việt
• Sau khi sửa, liệt kê rõ: "Đã thay đổi gì ở file nào, dòng nào"
```

---

## ══════════════════════════════════════════════════════
## PROMPT 2 — AI AUDIO SEPARATOR (Tách nhạc & lời)
## ══════════════════════════════════════════════════════

```
Hãy đọc toàn bộ code hiện tại của tính năng AI Audio Separator trong dự án này
(tìm theo từ khóa: audio, separator, tách nhạc, tách lời, stems).
Phân tích kỹ rồi cải thiện TOÀN DIỆN cả Frontend lẫn Backend theo tiêu chí sau:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — UX/UI & TRẢI NGHIỆM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] UPLOAD & FILE INFO:
• Dropzone hỗ trợ: MP3, WAV, M4A, FLAC, OGG, AAC — max 100MB
• Sau upload, hiển thị ngay: tên file, thời lượng (mm:ss), bitrate (kbps), sample rate (Hz), số kênh (Mono/Stereo), dung lượng
• Waveform tĩnh của file gốc: vẽ bằng Web Audio API + Canvas, hiển thị ngay sau upload (KHÔNG cần load lại trang)
• Mini player: play/pause file gốc trước khi tách, seek bằng click vào waveform
• Cảnh báo nếu chất lượng thấp: bitrate < 128kbps → "Chất lượng thấp, kết quả có thể không tốt"

[2] STEM CONFIGURATION:
• Mode selector card dạng visual (KHÔNG dùng dropdown):
  🎤 2 Stems: Vocals + Nhạc nền | ⚡ Nhanh nhất
  🥁 4 Stems: Vocals + Drums + Bass + Other | 🎯 Cân bằng
  🎹 5 Stems: Vocals + Drums + Bass + Piano + Other | ✨ Chi tiết nhất
• Mỗi card hiển thị: icon to, tên, danh sách stems, thời gian xử lý ước tính
• Quality preset:
  🚀 Nhanh (Draft) — cho preview
  ⚖️ Cân bằng (Standard) — mặc định
  💎 Chất lượng cao (HQ) — lấy thêm 2–3x thời gian, tooltip giải thích
• Output format: MP3 (128/192/256/320 kbps) | WAV (PCM 16/24-bit) | FLAC

[3] REAL-TIME PROGRESS:
• Timeline dọc với các bước: Upload → Phân tích → Tách stems → Encode → Hoàn thành
• Mỗi bước có icon + thời gian bắt đầu
• Progress bar tổng thể + progress bar riêng từng stem đang xử lý
• Hiển thị: "Đang tách Vocals (2/5 stems)..." với animated icon

[4] RESULT — MỖI STEM LÀ 1 CARD ĐỘC LẬP:
• Tên stem + Icon đại diện: 🎤 Giọng hát | 🥁 Trống | 🎸 Bass | 🎹 Piano | 🎵 Nhạc nền | 🎻 Khác
• Waveform animated: real-time visualization khi đang phát (AnalyserNode + requestAnimationFrame)
  → Waveform tĩnh khi dừng
• Custom audio player mỗi stem:
  - Play/Pause (spacebar khi stem đang focus)
  - Seek bar (click + kéo)
  - Thời gian hiện tại / Tổng thời gian
  - Volume slider + Mute button
  - Playback speed: 0.5x / 0.75x / 1x / 1.25x / 1.5x
• SOLO button: chỉ phát stem này, tắt tất cả stem còn lại
• MUTE button per stem: tắt 1 stem, các stem khác vẫn chạy đồng bộ
• Download button riêng mỗi stem
• Badge: dung lượng file output

[5] MIXER — TÍNH NĂNG NÂNG CAO:
• Volume slider riêng từng stem (0–200%)
• Tất cả stems phát đồng bộ (AudioContext.currentTime làm anchor)
• Nút "Phát Tất Cả" / "Dừng Tất Cả" với đồng bộ timeline
• Seek toàn bộ (1 seek bar master điều khiển tất cả)
• Export mix tùy chỉnh: chọn stem nào xuất + volume → tạo file mix mới

[6] FOOTER ACTIONS:
• "Tải Tất Cả (ZIP)" — hiện progress download
• "Tải Lại Từ Đầu" — confirm dialog trước khi reset
• "Lịch Sử" — 5 file gần nhất trong session

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND — NGHIỆP VỤ & HIỆU SUẤT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[7] VALIDATION:
• Validate thực sự bằng magic bytes (MP3: FF FB / ID3, WAV: RIFF, FLAC: fLaC)
• Đọc metadata audio (duration, bitrate) bằng JAudioTagger trước khi xử lý
• Từ chối nếu: duration > 600s, size > 100MB, bitrate < 64kbps
• Giới hạn concurrent jobs: max 2 jobs đồng thời/user (trả về 429 nếu vượt)

[8] ASYNC PIPELINE:
• POST /process → trả về jobId ngay (202)
• Progress tracking qua SSE (Server-Sent Events): GET /progress/{jobId}
  → stream: data: { step:"separating", stemName:"vocals", stemProgress:67, totalProgress:45, eta:38 }
• Hoặc WebSocket nếu đã có config sẵn trong dự án — dùng cái nào đã có
• Download endpoint: GET /download/{jobId}/{stemName} | GET /download/{jobId}/zip

[9] AUDIO PROCESSING:
• Gọi Python Demucs/Spleeter service qua HTTP nếu có
• Fallback Java: dùng FFmpeg (ProcessBuilder) để tách vocal/instrumental cơ bản
  → ffmpeg -i input.mp3 -af "stereotools=mode=ms>lr" ...
• Post-processing: normalize output (-23 LUFS), trim silence đầu/cuối
• ZIP creation: dùng java.util.zip.ZipOutputStream, stream trực tiếp không lưu file zip tạm

[10] FILE MANAGEMENT:
• Lưu theo cấu trúc: /uploads/ai-lab/audio-separator/{jobId}/vocals.mp3, drums.mp3...
• Job metadata lưu DB: jobId, userId, inputFile, stems[], status, createdAt, expiresAt
• Cleanup: @Scheduled xóa file + record sau 24h

━━━━━━━━━━
YÊU CẦU CHUNG
━━━━━━━━━━
• Giữ nguyên tất cả code hiện tại không liên quan
• Text hiển thị tiếng Việt, comments tiếng Việt
• Liệt kê rõ thay đổi ở file nào, dòng nào sau khi sửa
```

---

## ══════════════════════════════════════════════════════
## PROMPT 3 — AI BACKGROUND REMOVER (Xóa phông nền)
## ══════════════════════════════════════════════════════

```
Hãy đọc toàn bộ code hiện tại của tính năng AI Background Remover trong dự án này
(tìm theo từ khóa: background, remover, xóa nền, xóa phông, remove background).
Phân tích kỹ rồi cải thiện TOÀN DIỆN cả Frontend lẫn Backend theo tiêu chí sau:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — UX/UI & TRẢI NGHIỆM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] UPLOAD & PREVIEW:
• Dropzone chuẩn: PNG/JPG/WEBP/HEIC — max 25MB
• Preview ngay sau upload, hiển thị: kích thước ảnh (px), dung lượng, có khuôn mặt không (detect sơ bộ phía client nếu có)
• Click preview để xem full size trong lightbox

[2] MODE SELECTOR — 4 chế độ nền (tabs hoặc card grid):
① Xóa Hoàn Toàn: hiện nền checkerboard (dạng ô caro) để thấy transparent
② Thay Màu Solid: color picker đầy đủ (swatches + hex input + eyedropper nếu browser hỗ trợ)
   → Preset palette 12 màu phổ biến: Trắng, Xám #f5f5f5, Kem, Xanh dương nhạt, Xanh lá nhạt, Đen...
   → Preset đặc biệt "Ảnh thẻ chuẩn" → tự set màu xanh dương chuẩn VISA/CCCD
③ Thay Ảnh Nền: dropzone ảnh nền thứ 2 + scale options (Kéo dài / Giữ tỉ lệ / Cắt vừa / Center) + Blur slider 0–20px
④ Gradient: 2 color picker + hướng (Ngang/Dọc/Chéo 45°/Chéo 135°/Tỏa ra từ tâm)

[3] CANVAS EDITOR SAU KHI XỬ LÝ — tinh chỉnh mask:
• Nền checkerboard để thấy vùng transparent
• 2 chế độ brush: 
  - Brush Thêm (giữ lại nội dung): màu xanh lá, opacity 60%
  - Brush Xóa (loại bỏ khỏi foreground): màu đỏ, opacity 60%
• Brush settings: Size (5–150px slider + số), Hardness (0–100%)
• Zoom: scroll wheel, Ctrl+= / Ctrl+-, nút 100%/Fit
• Pan: Space + drag, hoặc Middle click drag
• Keyboard: B = Brush thêm, E = Erase, [ ] = giảm/tăng brush size, Ctrl+Z Undo, Ctrl+Y Redo
• Undo/Redo: tối đa 30 bước, hiển thị badge số lượng steps
• Nút "Xem Mask" (toggle xem B&W mask thuần)
• Nút "Tinh Chỉnh Tự Động" (gửi lại server với vùng đã vẽ thêm)

[4] EDGE REFINEMENT SETTINGS:
• Edge Feathering: slider 0–10px (làm mềm viền)
• Matting mode: [Cơ bản | Tóc/Lông (AlphaMatting) | Văn bản (Document)]
• Background Decontamination: checkbox (xóa màu nền bị lẫn vào tóc/lông)

[5] EXPORT OPTIONS:
• PNG transparent (mặc định)
• PNG + nền đã chọn (composite)
• JPG + nền (nếu là solid color/ảnh)
• SVG với embedded path (cho logo/illustration — optional nếu phức tạp)
• Resize trước khi xuất: preset (Original / 1080px / 720px / 512px) + custom px

[6] UI POLISH:
• Mọi thao tác canvas phải mượt mà ≥ 30fps trên máy tầm trung
• Cursor thay đổi đúng theo tool đang dùng (brush circle, crosshair, grab...)
• Toast notification nhẹ nhàng (không chiếm diện tích lớn) cho mỗi action
• Khu vực canvas responsive, tự fit vào viewport

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[7] SEGMENTATION PIPELINE:
• Endpoint A — xóa nền: POST /process → { outputUrl (PNG alpha), maskUrl (B&W) }
• Endpoint B — áp dụng nền: POST /apply-background → nhận foreground PNG + background config → trả composite
• Endpoint C — tinh chỉnh mask: POST /refine → nhận mask gốc + brush strokes JSON → trả mask mới
• Tất cả đều sync nếu < 5s, async nếu ước tính > 5s

[8] IMAGE PROCESSING:
• Gọi rembg Python service nếu có
• Fallback Java: GrabCut via JavaCV (OpenCV), tham số mặc định tốt cho portrait
• Post-process mask: morphological smoothing, alpha feathering theo cài đặt
• Composite background: Java AlphaComposite, hỗ trợ blur nền bằng GaussianBlur JavaCV
• Validate output: kiểm tra PNG có alpha channel thực sự không bị corrupt

[9] PERFORMANCE:
• Cache mask kết quả theo jobId (không xử lý lại nếu chỉ đổi màu nền)
• Resize ảnh > 4000px về 4000px trước khi xử lý (upscale lại sau nếu cần)
• Timeout 30s per request, trả lỗi rõ nếu timeout

━━━━━━━━━━
YÊU CẦU CHUNG
━━━━━━━━━━
• Giữ nguyên code không liên quan
• Text tiếng Việt, comments tiếng Việt
• Liệt kê thay đổi ở file nào sau khi sửa
```

---

## ══════════════════════════════════════════════════════
## PROMPT 4 — AI SMART CROP (Cắt ảnh thông minh)
## ══════════════════════════════════════════════════════

```
Hãy đọc toàn bộ code hiện tại của tính năng AI Smart Crop trong dự án này
(tìm theo từ khóa: smart crop, smartcrop, cắt ảnh, crop).
Phân tích kỹ rồi cải thiện TOÀN DIỆN cả Frontend lẫn Backend theo tiêu chí sau:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — UX/UI & TRẢI NGHIỆM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] PRESET RATIO — grid cards trực quan:
Hiển thị dưới dạng grid 4 cột, mỗi card có:
• Hình chữ nhật minh họa đúng tỉ lệ (SVG inline)
• Tên tỉ lệ + mô tả ứng dụng thực tế
• Highlight đặc biệt cho "Ảnh thẻ 3×4" (dùng nhiều nhất trong bệnh viện)

Danh sách đủ:
① Tự do (Free)
② Ảnh thẻ 3×4 — ★ Ứng dụng: CCCD, hồ sơ nhân viên
③ Vuông 1:1 — Avatar, mạng xã hội
④ A4 Dọc (210×297mm)
⑤ A4 Ngang (297×210mm)
⑥ 16:9 — Banner, màn hình
⑦ 4:3 — Ảnh màn hình cũ
⑧ 9:16 — Mobile/Story
⑨ Custom — 2 input số W:H

Khi chọn preset: hiển thị ngay kích thước output ước tính (px) bên cạnh

[2] CANVAS CROP EDITOR — tính năng đầy đủ:
• Ảnh hiển thị full-width trong canvas, crop box overlay
• Crop box: 8 handles (4 góc + 4 cạnh), kéo để resize
• Giữ tỉ lệ khi kéo góc (Shift để bỏ lock tỉ lệ)
• Di chuyển crop box: click và kéo bên trong
• Double-click ngoài crop box: reset về center
• Scroll wheel để zoom ảnh (không thay đổi crop ratio)
• Grid overlay (toggle):
  - Tam phần (Rule of Thirds): 2 đường ngang + 2 dọc
  - Vàng (Golden Ratio): phi grid
  - Đường chéo (Diagonal)
  - Tắt
• Vùng ngoài crop box: tối (opacity 0.5), không tối quá
• Mini live preview (góc dưới phải canvas, 150×150): xem trước vùng được cắt

[3] AI SUGGESTIONS:
• Sau khi phân tích, hiện tối đa 3 gợi ý bên dưới canvas
• Mỗi gợi ý: thumbnail nhỏ + điểm số (Rất tốt ★★★ / Tốt ★★ / Khá ★) + lý do ngắn
  → vd: "★★★ Khuôn mặt chính giữa, đủ khoảng trắng phía trên"
• Click vào gợi ý → crop box animate smooth tới vị trí đó
• Badge màu: xanh lá (Rất tốt), vàng (Tốt), xám (Khá)

[4] DETECTION OVERLAY (toggle bật/tắt):
• Hộp màu xanh: khuôn mặt được detect + % confidence
• Hộp màu vàng: vật thể quan trọng + nhãn
• Heatmap saliency (overlay gradient): vùng nóng = đỏ/cam, vùng lạnh = xanh, opacity 30%
• Nút "Phân Tích Ảnh" để trigger detection (không tự động để tránh chậm)

[5] OUTPUT SETTINGS:
• Kích thước xuất: dropdown preset + custom (width input, height tự tính theo ratio)
• Interpolation khi resize: [Bicubic (mặc định) | Bilinear | Nearest (cho pixel art)]
• Output format: PNG / JPEG (+ quality) / WEBP
• Padding: slider 0–20% (thêm viền trắng/màu xung quanh vùng cắt — hữu ích cho ảnh thẻ)
• Padding color picker (nếu padding > 0)

[6] BATCH MODE (nếu chưa có):
• Upload nhiều ảnh cùng lúc (max 20 ảnh)
• Áp dụng cùng 1 ratio + AI suggestion cho tất cả
• Download ZIP
• Progress hiển thị "Đang xử lý 3/20 ảnh..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[7] ANALYZE ENDPOINT: POST /analyze
• Input: MultipartFile image, List<String> detectTypes (face/object/saliency/text)
• Output:
  {
    faces: [{x,y,w,h,confidence,landmarks}],
    objects: [{x,y,w,h,label,confidence}],
    saliencyMapUrl: "...",
    suggestions: [
      {rank:1, cropX,cropY,cropW,cropH, score:0.94, reason:"Khuôn mặt cân đối, đủ headroom"}
    ]
  }
• Face detection: OpenCV HaarCascade (JavaCV) — nhanh, đủ dùng
• Saliency: Spectral Residual via OpenCV SaliencySpectralResidual
• Suggestion scoring:
  - Face coverage (mặt chiếm 40–70% chiều cao crop = tốt)
  - Face position (center third = tốt)
  - Saliency coverage (% saliency mass trong crop)
  - Rule-of-thirds alignment bonus
  - Penalty nếu crop cắt mặt

[8] PROCESS ENDPOINT: POST /process
• Input: MultipartFile image, int cropX, cropY, cropW, cropH, int outputW, int outputH, String format, float paddingPercent, String paddingColor
• Crop → pad → resize → encode theo format
• Java ImageIO cho crop/pad/resize, không cần heavy library
• Trả về: { outputUrl, outputWidth, outputHeight, fileSizeBytes, processingTimeMs }

[9] BATCH ENDPOINT: POST /batch-process
• Input: List<MultipartFile> images, cropConfig (ratio, useAiSuggestion, outputConfig)
• Xử lý song song với ThreadPoolExecutor (max 4 threads)
• Trả về jobId, poll status, download ZIP

━━━━━━━━━━
YÊU CẦU CHUNG
━━━━━━━━━━
• Giữ nguyên code không liên quan
• Text tiếng Việt, comments tiếng Việt
• Liệt kê thay đổi ở file nào sau khi sửa
```

---

## ══════════════════════════════════════════════════════
## PROMPT 5 — AI PHOTO RESTORER (Phục hồi ảnh cũ)
## ══════════════════════════════════════════════════════

```
Hãy đọc toàn bộ code hiện tại của tính năng AI Photo Restorer trong dự án này
(tìm theo từ khóa: restore, restorer, photo restore, phục hồi ảnh).
Phân tích kỹ rồi cải thiện TOÀN DIỆN cả Frontend lẫn Backend theo tiêu chí sau:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — UX/UI & TRẢI NGHIỆM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] UPLOAD:
• Định dạng hỗ trợ: PNG, JPG, WEBP, TIFF, BMP — max 30MB
• Preview + metadata: tên, kích thước, ngày chụp (EXIF), có phát hiện ảnh đen trắng không (auto-detect histogram)
• Nếu detect là ảnh đen trắng: tự động check sẵn module "Tô màu"

[2] RESTORATION MODULES — mỗi module là 1 card có thể bật/tắt riêng:

Card ① — Xóa Vết Xước & Hư Hỏng:
• Toggle on/off
• Sensitivity: slider 1–10 + label (Ít xước / Xước vừa / Hư hỏng nặng)
• Auto-detect: checkbox (server tự phát hiện vùng hư hỏng)
• Preview nhỏ: thumbnail bên cạnh slider

Card ② — Khử Nhiễu:
• Toggle on/off
• Mức độ: slider 1–10
• Loại nhiễu: [Tất cả | Hạt phim (Film Grain) | JPEG vỡ | Pixel noise]
• Preview nhỏ

Card ③ — Làm Sắc Nét:
• Toggle on/off
• Cường độ: 0–200%
• Radius: 0.5–3.0px
• Threshold: 0–255
• Nút "Tự Động" (server tính toán giá trị tối ưu)

Card ④ — Tô Màu (chỉ khi ảnh đen trắng):
• Toggle on/off (disabled với tooltip nếu ảnh đã có màu)
• Phong cách: [Tự nhiên | Cổ điển (warm tone) | Sống động | Theo thời kỳ lịch sử]
• Skin tone: slider -50 đến +50 (Lạnh hơn / Ấm hơn)

Card ⑤ — Cải Thiện Khuôn Mặt:
• Toggle on/off
• Mức độ: [Nhẹ (tự nhiên) | Vừa | Mạnh]
• Bảo toàn danh tính: checkbox (không thay đổi đặc điểm nhận dạng)

[3] THỨ TỰ XỬ LÝ:
• Drag-and-drop sắp xếp thứ tự các module (vì thứ tự quan trọng)
• Hiển thị thứ tự bằng số badge
• Tooltip: "Thứ tự xử lý ảnh hưởng đến kết quả. Thường: Khử nhiễu → Xóa xước → Sắc nét → Tô màu"

[4] BEFORE/AFTER SLIDER — bắt buộc đủ:
• Kỹ thuật clip-path (KHÔNG dùng 2 ảnh xếp cạnh nhau)
• Thanh kéo có icon ←→ ở giữa, dễ kéo trên mobile (touch area đủ lớn)
• Label nổi: "TRƯỚC" (trái) | "SAU" (phải)
• Magnifier lens: hover hiện vùng zoom 3x tại vị trí chuột, cả 2 phía
• Zoom tổng thể: scroll + buttons + nút "Fit"
• Nút Fullscreen (dùng Fullscreen API)
• Keyboard: ← → di chuyển slider, Z toggle zoom, F fullscreen

[5] LIVE PREVIEW TỪNG MODULE:
• Sau khi mỗi module xử lý xong → auto-update ảnh preview bên phải
• Loading skeleton cho phần chưa xử lý xong
• Dòng trạng thái: "✓ Khử nhiễu xong (0.8s) | ⏳ Đang xóa vết xước... | ○ Chờ"

[6] HISTORY TRONG SESSION:
• Tối đa 10 version gần nhất
• Mỗi version: thumbnail nhỏ + modules đã dùng + thời gian tạo
• Click để load lại settings của version đó
• Nút "So Sánh Với Version Này"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[7] PIPELINE ARCHITECTURE:
• Nhận: image + ordered list of modules + settings per module
• Xử lý tuần tự theo thứ tự gửi lên
• Mỗi module = 1 RestorationStep interface: boolean canProcess(image), BufferedImage process(image, settings)
• Sau mỗi step: lưu intermediate result, emit SSE progress event

[8] SSE PROGRESS STREAMING:
• GET /progress/{jobId} → text/event-stream
• Event format: data: {"module":"denoise","status":"done","progress":40,"previewBase64":"...","timeTakenMs":820}
• previewBase64: thumbnail 300px để frontend update preview realtime
• Frontend dùng EventSource API để nhận SSE

[9] MODULE IMPLEMENTATIONS:
• Denoise: OpenCV fastNlMeansDenoisingColored (JavaCV) — h=10, hColor=10 là default tốt
• Scratch removal: OpenCV inpaint TELEA — tự detect scratch bằng morphological operations (đường dài, mảnh)
• Sharpen: ConvolveOp với unsharp mask kernel, hoặc OpenCV filter2D
• Colorize: Gọi Python service (DeOldify hoặc colorize endpoint); fallback: grayscale→sepia tone nếu không có service
• Face enhance: Gọi Python GFPGAN service; fallback: OpenCV CLAHE để tăng tương phản mặt
• Detect B&W: so sánh saturation histogram, nếu avg saturation < 0.08 → kết luận ảnh đen trắng

[10] RESPONSE:
• Async: POST /process → { jobId }
• SSE: GET /progress/{jobId} → stream từng module
• Final: GET /result/{jobId} → { finalOutputUrl, moduleResults:[{name,timeTakenMs,beforeUrl,afterUrl}] }

━━━━━━━━━━
YÊU CẦU CHUNG
━━━━━━━━━━
• Giữ nguyên code không liên quan
• Text tiếng Việt, comments tiếng Việt
• Liệt kê thay đổi ở file nào sau khi sửa
```

---

## ══════════════════════════════════════════════════════
## PROMPT 6 — AI OBJECT ERASER (Xóa vật thể)
## ══════════════════════════════════════════════════════

```
Hãy đọc toàn bộ code hiện tại của tính năng AI Object Eraser trong dự án này
(tìm theo từ khóa: erase, eraser, object eraser, xóa vật thể, inpaint).
Phân tích kỹ rồi cải thiện TOÀN DIỆN cả Frontend lẫn Backend theo tiêu chí sau:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — UX/UI & TRẢI NGHIỆM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] LAYOUT — CANVAS CHIẾM CHỦ ĐẠO:
• Canvas chiếm ít nhất 70% diện tích màn hình
• Toolbar trên: compact, icon-based (tooltip khi hover)
• Settings panel: slide-in từ phải, có thể ẩn để canvas rộng hơn
• Trên mobile: settings panel bên dưới canvas

[2] TOOLBAR ĐẦY ĐỦ:
Nhóm File: [Upload Ảnh Mới] [Undo ⌘Z] [Redo ⌘Y] [Reset Mask]
Nhóm Tool: 
  🖌️ Brush (B) — tô vùng xóa
  🔷 Lasso (L) — vẽ đường bao tự do, click để thêm điểm, Enter để đóng
  ▭ Rectangle (R) — kéo hình chữ nhật
  🔮 Magic Wand (W) — chọn theo màu tương tự
Nhóm Mask: [➕ Thêm Vào Mask] [➖ Xóa Khỏi Mask]
Nhóm View: [Ẩn/Hiện Mask] [Zoom In/Out] [Fit to Screen]
Nhóm Process: [⚡ Xử Lý AI] [↩ Tinh Chỉnh Thêm] [⬇ Download]

[3] BRUSH TOOL — mượt mà:
• Cursor: hình tròn đúng kích thước brush (CSS custom cursor hoặc canvas cursor)
• Stroke smooth: Catmull-Rom spline interpolation giữa các mousemove points
• Pressure sensitivity: nếu PointerEvent.pressure > 0 → điều chỉnh opacity stroke
• Size: scroll wheel thay đổi brush size khi đang dùng brush tool (kết hợp Ctrl)
• [ ] để giảm/tăng brush size (phím tắt Photoshop-style)

[4] MAGIC WAND TOOL — phía client:
• Flood fill algorithm (4-connectivity) dựa trên pixel color
• Tolerance slider 0–100 hiện ngay trên toolbar khi active tool này
• Shift + click để thêm vào selection (KHÔNG xóa selection cũ)
• Alt + click để trừ khỏi selection
• Hiển thị selection outline (marching ants animation — dashed border di chuyển)

[5] MASK VISUALIZATION:
• Mặc định: vùng mask = đỏ semi-transparent (opacity có thể điều chỉnh 30–80%)
• Toggle xem mask thuần B&W (phím M)
• Toggle ẩn mask hoàn toàn để xem ảnh gốc (phím V)
• Nút "Expand Mask" +Npx và "Contract Mask" -Npx (feather selection)
• Nút "Invert Mask"

[6] PROCESSING & RESULTS:
• Nút "Xử Lý AI" hiện dropdown chọn method:
  ⚡ Nhanh (Telea) — vùng nhỏ < 5% ảnh
  🎯 Cân Bằng (Navier-Stokes) — vùng trung bình
  ✨ Chất Lượng Cao (LaMa/AI) — kết quả tốt nhất, chậm hơn
  🤖 Prompt AI — điền nền theo mô tả (nếu có SD service)
• Progress: spinner + "Đang điền nền tự nhiên..."
• Kết quả: hiện 2–3 variations nếu backend generate nhiều
  → User click để chọn kết quả ưng nhất
  → Nút "Thử Lại" (server generate thêm 1 variation mới)
  → Nút "Tinh Chỉnh Thêm" → load kết quả vào canvas tiếp tục erase
• Before/After toggle (không dùng slider — dùng click/hold để xem gốc)

[7] UNDO/REDO HISTORY PANEL (toggle hiển thị):
• List các bước: icon + tên action + thumbnail nhỏ
• Click để jump đến bất kỳ bước nào
• Max 30 steps trong memory

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[8] INPAINTING ENDPOINTS:
• POST /process: image + mask (white=erase) + method + prompt(optional)
  → Async nếu method = lama/sd, sync nếu telea/ns (< 3s)
  → Trả về: { jobId (nếu async) | results:[{url,method,variationIndex}] }
• POST /variation: tạo thêm 1 variation từ cùng input (không upload lại)
• POST /refine: image hiện tại + mask bổ sung → chạy lại inpainting chỉ vùng mới

[9] PROCESSING:
• Telea/NS: OpenCV inpaint() qua JavaCV — nhanh, đủ tốt cho vùng đơn giản
• LaMa: HTTP call đến Python LaMa service (nếu có), fallback = Telea
• Mask preprocessing: dilate 3px để tránh viền cứng, Gaussian blur edge 2px
• Multi-variation: chạy 3 lần với noise seed khác nhau (cho AI methods)
• Quality check: tính BRISQUE score của từng variation, sort by score
• Validate: mask không quá 60% diện tích ảnh (tránh xóa quá nhiều nội dung)

[10] MAGIC WAND SERVER-SIDE (optional — nếu client-side không đủ chính xác):
• POST /magic-wand: image + clickX + clickY + tolerance
• Dùng OpenCV floodFill để generate mask
• Trả về: mask PNG (B&W)
• Client dùng kết quả này thay vì tự tính

━━━━━━━━━━
YÊU CẦU CHUNG
━━━━━━━━━━
• Giữ nguyên code không liên quan
• Text tiếng Việt, comments tiếng Việt
• Liệt kê thay đổi ở file nào sau khi sửa
```

---

## ══════════════════════════════════════════════════════
## PROMPT 7 — AI VOICE CLONER (Nhân bản giọng nói)
## ══════════════════════════════════════════════════════

```
Hãy đọc toàn bộ code hiện tại của tính năng AI Voice Cloner trong dự án này
(tìm theo từ khóa: voice, cloner, voice clone, nhân bản giọng, tts, text to speech).
Phân tích kỹ rồi cải thiện TOÀN DIỆN cả Frontend lẫn Backend theo tiêu chí sau:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — UX/UI & TRẢI NGHIỆM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] DISCLAIMER & CONSENT (bắt buộc, không thể bỏ qua):
• Modal hiện lần đầu tiên dùng (check localStorage)
• Nội dung: "Công cụ này chỉ được sử dụng cho mục đích chính thức của Bệnh viện Tân Phú. Nghiêm cấm tạo giọng nói giả mạo người khác khi chưa có sự đồng ý. Vi phạm có thể bị xử lý kỷ luật."
• Phải scroll đến cuối mới bật được checkbox
• Lưu: userId + timestamp vào DB (không chỉ localStorage)
• Kiểm tra consent phía server trước mỗi API call

[2] TAB 1 — THU THẬP GIỌNG NÓI:

Section A — Ghi âm trực tiếp:
• Nút bắt đầu/dừng ghi: to, rõ ràng, có animation pulsing khi đang ghi
• Timer đếm lên: mm:ss (xanh lá khi OK, vàng khi gần đủ, xanh đậm khi đủ 30s)
• Waveform realtime: bars animation theo âm lượng (AnalyserNode, 64 bars, smooth)
• Volume meter: thanh dọc bên cạnh, hiện màu đỏ khi quá to (clipping warning)
• Chất lượng indicator: 
  - SNR (Signal-to-Noise Ratio) — tính real-time, hiện "Tốt / Khá / Kém"
  - "Giảm tiếng ồn xung quanh để có kết quả tốt hơn"
• Đoạn văn mẫu tiếng Việt để đọc (cố định, ngắn gọn, đủ âm vị):
  "Xin chào quý bệnh nhân, đây là thông báo từ Bệnh viện Đa khoa Tân Phú. 
   Phòng khám số hai đã sẵn sàng đón tiếp. Vui lòng mang theo giấy tờ tùy thân."
• Playback recording vừa thu: mini player
• Danh sách recordings: tên (tự đặt) + thời lượng + chất lượng + play + delete

Section B — Upload file:
• Dropzone: MP3, WAV, M4A — 30s đến 10 phút
• Sau upload: hiện waveform tĩnh + metadata + quality check

Nút "Tạo Voice Profile": 
• Disabled nếu tổng audio < 30s
• Progress bar training (poll /status/{profileId})
• ETA hiển thị

[3] TAB 2 — VOICE PROFILES:
• Grid card mỗi profile:
  - Avatar circle màu ngẫu nhiên (seed từ profileId) + tên viết tắt
  - Tên profile (click để đổi tên inline — contenteditable)
  - Thời lượng training audio
  - Quality score (badge: Xuất sắc ≥90 / Tốt ≥70 / Khá ≥50)
  - Ngày tạo
  - Nút "Phát Thử" (TTS 5 chữ mẫu bằng giọng này)
  - Nút "Xóa" với confirm dialog
• Empty state: illustration + "Chưa có profile nào. Bắt đầu bằng cách ghi âm giọng nói."
• Sort: Mới nhất / Chất lượng cao nhất / Tên A-Z

[4] TAB 3 — TẠO GIỌNG NÓI:

LEFT — Soạn thảo:
• Voice profile selector: dropdown có play button để nghe thử ngay
• Textarea soạn nội dung:
  - Placeholder: "Nhập nội dung cần đọc..."
  - Character counter: hiện/max (ví dụ: 247/5000)
  - Syntax highlight: {tên}, [dừng], **nhấn mạnh** (visual hint, KHÔNG phải markdown thực)
• Toolbar nhanh:
  [Thêm điểm dừng 500ms] [Nhấn mạnh] [Đánh vần từng chữ] [Số → Chữ] [Xóa định dạng]
• Preset nội dung bệnh viện (dropdown):
  "Mời bệnh nhân số {STT} đến phòng khám số {PHONG}"
  "Thông báo: Phòng {PHONG} tạm ngưng hoạt động"
  "Xin chào quý bệnh nhân, bệnh viện sẽ đóng cửa lúc {GIO}"
  → Click → điền vào textarea, user sửa placeholder trong {}

RIGHT — Cài đặt & Kết quả:
• Cài đặt:
  - Tốc độ: slider 0.5x–2.0x + preset nút (0.75 / 1.0 / 1.25 / 1.5)
  - Cao độ: slider -10 đến +10 (semitones)
  - Năng lượng: slider 0.5–1.5
  - Ngôn ngữ: [Tiếng Việt | Anh | Tự động nhận diện]
  - Khoảng nghỉ cuối câu: 0–1000ms
• Nút "Tạo Giọng Đọc" (to, nổi bật)
• Loading: waveform animation skeleton khi đang generate

Kết quả player:
• Waveform visualization animated khi play (canvas)
• Play/Pause / Seek / Volume / Speed
• Waveform clickable để seek
• Thông tin: thời lượng, dung lượng, giọng dùng, thời gian tạo
• Export:
  MP3 128kbps / 192kbps / 320kbps
  WAV 44.1kHz PCM
  Tên file tự động: TTS_{ngày}_{giờ}_{10 ký tự đầu nội dung}.mp3
• History 10 file gần nhất: mini list, click để load lại + play

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[5] CONSENT ENFORCEMENT:
• Filter/Interceptor: mọi request đến /voice-cloner/** kiểm tra bảng ai_lab_voice_consent
• Nếu chưa consent → 403 + { code:"CONSENT_REQUIRED", message:"Vui lòng đồng ý điều khoản sử dụng" }
• POST /consent: lưu userId + IP + userAgent + timestamp

[6] AUDIO QUALITY CHECK:
• Khi nhận training audio: tính SNR bằng FFT (Java)
  → SNR < 10dB: từ chối, hướng dẫn ghi âm lại
  → 10–20dB: chấp nhận, cảnh báo chất lượng
  → >20dB: tốt
• Validate duration: tổng audio 30s–10 phút
• Resample về 22050Hz mono nếu cần (FFmpeg ProcessBuilder)

[7] TRAINING ENDPOINT:
• POST /create-profile: async, trả về profileId + jobId
• Poll: GET /profiles/{profileId}/training-status → { status, progress, eta, qualityScore }
• Gọi Coqui XTTS Python service nếu có; fallback = lưu audio thuần, dùng Google TTS khi synthesize
• Quality score: tính từ SNR + duration + spectral analysis

[8] SYNTHESIS ENDPOINT:
• POST /synthesize:
  { profileId, text, speed, pitch, energy, language, sentencePauseMs }
• Rate limit: Resilience4j @RateLimiter — 50 requests/user/ngày (configurable trong application.yml)
• SSML preprocessing: convert [dừng] → <break>, **text** → <emphasis>
• Trả về: { audioUrl, durationMs, fileSizeBytes }
• Log mỗi synthesis: userId, profileId, textLength, processingTimeMs, timestamp

[9] SECURITY:
• Tất cả file training + output lưu trong thư mục private, KHÔNG expose trực tiếp qua static URL
• Serve qua endpoint có auth: GET /audio/{jobId}/{filename} → kiểm tra userId match
• Tự động xóa output sau 24h
• Training audio xóa sau khi training xong (chỉ giữ model)

[10] FALLBACK TTS (khi không có Python service):
• Tích hợp Google Cloud TTS API (nếu có API key trong config)
• Hoặc FreeTTS/MaryTTS Java library
• Hoặc call https://api.zalo.ai/v1/tts/synthesize (Zalo AI TTS tiếng Việt — nếu phù hợp)
• Cấu hình trong application.yml: ai-lab.voice-cloner.tts-provider: xtts | google | zalo | marytts

━━━━━━━━━━
YÊU CẦU CHUNG
━━━━━━━━━━
• Giữ nguyên code không liên quan
• Text tiếng Việt, comments tiếng Việt
• Liệt kê thay đổi ở file nào sau khi sửa
```

---

## ══════════════════════════════════════════════════════
## 📌 HƯỚNG DẪN SỬ DỤNG CÁC PROMPT TRÊN
## ══════════════════════════════════════════════════════

**Cách dùng hiệu quả nhất trong Claude Code:**

1. Mở terminal trong thư mục dự án
2. Chạy: `claude`
3. Paste nguyên prompt của tool muốn cải thiện
4. Claude Code sẽ tự: đọc code hiện tại → phân tích → đề xuất → sửa

**Nếu muốn cụ thể hơn, thêm 1 dòng đầu prompt:**
> "Tập trung vào file: src/pages/AILab/tools/[TênTool]/index.jsx 
>  và backend: src/main/java/.../AiLabController.java"

**Nếu muốn sửa từng phần nhỏ:**
> Thêm cuối prompt: "Chỉ thực hiện mục [3] và [7] trước, các mục còn lại để sau"

**Thứ tự ưu tiên cải thiện gợi ý:**
① Background Remover (nhiều người dùng nhất)
② Audio Separator (phức tạp nhất, dễ có lỗi)
③ Photo Restorer (value cao nhất)
④ Smart Crop
⑤ Image Upscaler
⑥ Object Eraser
⑦ Voice Cloner (nhạy cảm nhất, làm sau cùng)
