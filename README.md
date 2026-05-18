# Convert URL Studio

Ứng dụng chuyển URL video được phép sử dụng sang MP4 hoặc MP3.

## Stack

- Frontend: React, TypeScript, Vite, lucide-react.
- Backend: Node.js TypeScript, yt-dlp, ffmpeg, ffprobe.
- Deploy đề xuất miễn phí: Vercel cho frontend, Koyeb hoặc Render Free cho backend Docker.

## Chạy local

```powershell
npm start
```

Mở:

```text
http://localhost:5173
```

## Deploy miễn phí: Vercel + backend free

### 1. Deploy backend free trước

Backend cần chạy Docker vì phải có `yt-dlp`, `ffmpeg`, `ffprobe`.

#### Option A: Koyeb Free

Koyeb Free Instance hiện cho 1 web service miễn phí với 512 MB RAM, 0.1 vCPU, 2 GB SSD, scale to zero khi không có traffic. Phù hợp demo/hobby, không phù hợp production nặng.

Các bước:

1. Push repo lên GitHub.
2. Vào Koyeb, tạo Web Service mới từ GitHub repo.
3. Chọn deploy bằng Dockerfile.
4. Port dùng:

```text
8080
```

5. Sau khi deploy xong, copy backend URL dạng:

```text
https://your-app.koyeb.app
```

#### Option B: Render Free

Render Free Web Service cũng deploy được Docker, nhưng filesystem là ephemeral và service free có giới hạn. Phù hợp demo/hobby.

Repo đã có:

```text
render.yaml
Dockerfile
```

Các bước:

1. Push repo lên GitHub.
2. Vào Render, tạo Web Service từ repo.
3. Chọn Docker.
4. Plan chọn Free.
5. Sau khi deploy xong, copy backend URL dạng:

```text
https://your-app.onrender.com
```

### 2. Deploy frontend lên Vercel Free

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
VITE_API_BASE_URL=https://your-backend-domain.com
```

Ví dụ:

```text
VITE_API_BASE_URL=https://your-app.koyeb.app
```

4. Deploy lại frontend.

## Giới hạn của free backend

Free backend có thể chạy được demo, nhưng cần hiểu rõ:

- Convert video dùng CPU/RAM nhiều, free instance sẽ chậm.
- Service có thể sleep khi không có traffic.
- File output trên Render/Koyeb free không nên xem là lưu trữ bền vững.
- Video dài hoặc chất lượng cao có thể fail do timeout/tài nguyên.

Nếu muốn chạy ổn định thật, nên dùng VPS nhỏ hoặc backend trả phí.

## Build local

```powershell
npm run check
npm run build
```

## Công cụ backend cần có nếu chạy không dùng Docker

```powershell
node --version
yt-dlp --version
ffmpeg -version
ffprobe -version
```

## Lưu ý

Chỉ dùng với nội dung bạn sở hữu, có giấy phép, hoặc được tác giả cho phép. Tool không gỡ DRM và không vượt qua cơ chế bảo vệ nội dung.
