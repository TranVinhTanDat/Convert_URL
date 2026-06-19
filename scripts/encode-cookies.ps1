# Encode YouTube cookies.txt to base64 for YTDLP_COOKIES_BASE64 env var on Render.
#
# How to use:
#   1. Install "Get cookies.txt LOCALLY" Chrome extension
#   2. Log in to youtube.com, watch a video to confirm the session works
#   3. Click the extension → tab "Current Site" → Export As → Netscape
#   4. Save to Desktop as youtube.com_cookies.txt
#   5. Run this script in PowerShell:
#        cd <project-root>
#        powershell -ExecutionPolicy Bypass -File scripts/encode-cookies.ps1
#   6. Paste the clipboard content into Render → service → Environment →
#      Add Variable: YTDLP_COOKIES_BASE64 = <paste>
#   7. Render auto-restarts and YouTube downloads start working.
#
# To verify after deploy:
#   GET https://<your-app>.onrender.com/api/health
#   → "ytdlpCookiesReady": true

param(
    [string]$CookiesFile = "$env:USERPROFILE\Desktop\youtube.com_cookies.txt"
)

if (-not (Test-Path $CookiesFile)) {
    Write-Host "ERROR: Không tìm thấy file $CookiesFile" -ForegroundColor Red
    Write-Host "Sửa tham số -CookiesFile thành đúng đường dẫn:" -ForegroundColor Yellow
    Write-Host '  powershell -File scripts/encode-cookies.ps1 -CookiesFile "C:\path\to\cookies.txt"' -ForegroundColor Yellow
    exit 1
}

$content = Get-Content $CookiesFile -Raw -Encoding UTF8

# Quick sanity check
if (-not ($content -match 'youtube\.com')) {
    Write-Host "WARNING: File không chứa 'youtube.com' — có thể export sai." -ForegroundColor Yellow
}

$bytes = [Text.Encoding]::UTF8.GetBytes($content)
$base64 = [Convert]::ToBase64String($bytes)

try {
    $base64 | Set-Clipboard
    $clipboardOk = $true
} catch {
    $clipboardOk = $false
}

Write-Host ""
Write-Host "✓ Đã encode base64 ($($base64.Length) chars, $($content.Length) bytes nội dung)" -ForegroundColor Green
if ($clipboardOk) {
    Write-Host "✓ Đã copy vào clipboard — paste vào Render env var YTDLP_COOKIES_BASE64" -ForegroundColor Green
} else {
    Write-Host "  (Không copy được vào clipboard — copy thủ công đoạn dưới)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host $base64
}
Write-Host ""
Write-Host "Preview 80 ký tự đầu:" -ForegroundColor Cyan
Write-Host $base64.Substring(0, [Math]::Min(80, $base64.Length))
Write-Host ""
Write-Host "===== HƯỚNG DẪN SET ENV VAR =====" -ForegroundColor Cyan
Write-Host "1. dashboard.render.com → service convert-url-api → Environment"
Write-Host "2. Add Environment Variable:"
Write-Host "     Key:   YTDLP_COOKIES_BASE64"
Write-Host "     Value: <paste clipboard>"
Write-Host "3. Save → Render tự restart"
Write-Host "4. Verify: GET /api/health → 'ytdlpCookiesReady': true"
