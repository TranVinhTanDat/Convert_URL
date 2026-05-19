---
title: Convert URL Studio API
emoji: 🎬
colorFrom: teal
colorTo: red
sdk: docker
app_port: 8080
---

# Convert URL Studio

Ứng dụng chuyển URL video được phép sử dụng sang MP4 hoặc MP3.

## Stack

- Frontend: React, TypeScript, Vite, lucide-react.
- Backend: Node.js TypeScript, yt-dlp, ffmpeg, ffprobe, ExcelJS, fast-xml-parser, LibreOffice.
- Deploy miễn phí đề xuất lúc này: Vercel cho frontend, Hugging Face Spaces Docker cho backend.

## Tiện ích hiện có

- URL video sang MP4/MP3.
- Excel sang JSON.
- JSON sang Excel.
- Excel sang XML.
- XML sang Excel.
- Excel sang CSV.
- CSV sang Excel.
- Word sang PDF.
- PDF sang Word thử nghiệm, chất lượng phụ thuộc PDF gốc.

## Chạy local

```powershell
npm start
```

Mở:

```text
http://localhost:5173
```

## Vì sao không dùng Koyeb?

Koyeb đang bắt verify credit card/pro plan với tài khoản của bạn, nên không nên nhập thẻ nếu mục tiêu là miễn phí hoàn toàn.

## Backend miễn phí: Hugging Face Spaces Docker

Hugging Face Spaces hỗ trợ Docker Spaces. Docker Space dùng `app_port` trong README YAML; repo này đã set:

```yaml
sdk: docker
app_port: 8080
```

Các bước:

1. Tạo tài khoản Hugging Face.
2. Vào:

```text
https://huggingface.co/new-space
```

3. Chọn:

```text
SDK: Docker
Visibility: Public
Hardware: CPU basic/free
```

4. Tạo Space.
5. Upload/push toàn bộ source này lên Space repo, hoặc connect/import từ GitHub nếu tài khoản của bạn có lựa chọn đó.
6. Chờ Space build Dockerfile.
7. Khi chạy xong, backend URL thường có dạng:

```text
https://username-space-name.hf.space
```

8. Test:

```text
https://username-space-name.hf.space/api/health
```

Nếu thấy JSON `ready: true` là backend đã OK.

## Frontend miễn phí: Vercel

Repo đã có:

```text
vercel.json
```

Vercel sẽ build frontend bằng:

```text
npm run build:client
```

Output:

```text
dist/client
```

Các bước:

1. Import GitHub repo vào Vercel.
2. Vào Project Settings -> Environment Variables.
3. Thêm:

```text
VITE_API_BASE_URL=https://username-space-name.hf.space
```

4. Deploy lại frontend.

## CORS

Backend đã hỗ trợ CORS qua biến:

```text
CORS_ORIGIN=*
```

Khi production nghiêm túc hơn, đổi thành domain Vercel của bạn:

```text
CORS_ORIGIN=https://your-project.vercel.app
```

## Giới hạn free backend

Free backend phù hợp demo/hobby, không đảm bảo xử lý video dài:

- CPU free có thể chậm.
- Space có thể sleep/rebuild.
- File output không nên xem là lưu trữ bền vững.
- Video dài/chất lượng cao có thể fail vì tài nguyên.
- Word/PDF cần LibreOffice trong Docker. Sau khi thay Dockerfile, cần redeploy backend để có `soffice`.

## Build local

```powershell
npm run check
npm run build
```

## Lưu ý

Chỉ dùng với nội dung bạn sở hữu, có giấy phép, hoặc được tác giả cho phép. Tool không gỡ DRM và không vượt qua cơ chế bảo vệ nội dung.
