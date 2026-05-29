# Public Deploy Notes

Neu deploy backend public de nhieu nguoi dung tinh nang YouTube MP4/MP3, hay cau hinh cac bien moi truong sau tren Render:

```text
YTDLP_COOKIES_BASE64=<noi dung cookies.txt da base64>
PUBLIC_RATE_WINDOW_SECONDS=3600
PUBLIC_RATE_MAX_JOBS=12
PUBLIC_MAX_ACTIVE_JOBS=2
PUBLIC_MAX_MEDIA_SECONDS=1800
PUBLIC_MAX_PLAYLIST_ITEMS=10
```

Giai thich nhanh:

- `YTDLP_COOKIES_BASE64`: giup backend yt-dlp co cookies hop le khi YouTube yeu cau xac minh "not a bot". Khong co bien nay thi mot so video se van bi loi tren Render.
- `PUBLIC_RATE_MAX_JOBS`: so job toi da cho moi IP trong mot khung thoi gian.
- `PUBLIC_MAX_ACTIVE_JOBS`: so job dang chay dong thoi cho moi IP.
- `PUBLIC_MAX_MEDIA_SECONDS`: gioi han do dai video, mac dinh 1800 giay.
- `PUBLIC_MAX_PLAYLIST_ITEMS`: gioi han so item khi cho phep playlist.

Backend expose trang thai tai:

```text
/api/health
```

Trong JSON co `ytdlpCookiesReady` va `publicLimits` de kiem tra cau hinh deploy.

Luu y: tinh nang tai/chuyen doi chi nen dung voi noi dung ban so huu, co giay phep, hoac duoc tac gia cho phep.
