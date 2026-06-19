FROM node:20-bookworm-slim AS base

WORKDIR /app

# ===== LAYER 1: System deps (~1 GB) — apt-get base tooling =====
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg fontconfig python3 python3-pip \
      libreoffice-writer libreoffice-calc \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-vie \
      ghostscript pngquant unpaper qpdf \
      libgl1 libglib2.0-0 \
      fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk \
  && fc-cache -f \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# ===== LAYER 2: Lightweight pip deps (~300 MB) — always installed =====
# yt-dlp, pdf2docx, OCR stack, OpenCV w/ xphoto (xoá vật thể fallback)
# curl_cffi: enables yt-dlp browser impersonation — REQUIRED for TikTok downloads
# (without it: "Unable to extract universal data for rehydration").
RUN python3 -m pip install --no-cache-dir --break-system-packages --upgrade \
      yt-dlp curl_cffi pdf2docx pymupdf pytesseract pillow python-docx \
      opencv-contrib-python-headless ocrmypdf \
  && python3 -m yt_dlp --version \
  && pdf2docx --help >/dev/null \
  && tesseract --version >/dev/null \
  && ocrmypdf --version >/dev/null \
  && python3 -c "import fitz, pytesseract, docx, PIL; print('scan OCR ready')" \
  && python3 -c "import cv2; print('cv2', cv2.__version__, 'xphoto:', hasattr(cv2, 'xphoto'))"

# ===== LAYER 3: rembg (xoá nền AI + auto-detect in Xoá vật thể) ~500 MB =====
# Backend calls `rembg i -m u2net in out` via shell. The rembg 2.x CLI eager-loads
# all command modules at startup (i/p/s/b) — `s_command` needs gradio + fastapi
# so [cli] extras are required. Separately, `[cpu]` extras pull onnxruntime which
# is what actually runs the U2Net model. WITHOUT [cpu], even `import rembg`
# fails with "pip install rembg[cpu]" hint. We install BOTH extras.
# Build-time verification uses Python import only (CLI init can crash in headless
# Docker due to gradio 6.x audio/display probes — irrelevant for our backend
# usage, which spawns `rembg i ...` lazily at request time).
ARG INSTALL_REMBG=1
RUN if [ "$INSTALL_REMBG" = "1" ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages "rembg[cpu,cli]" \
      && python3 -c "import onnxruntime; print('onnxruntime', onnxruntime.__version__)" \
      && python3 -c "import rembg; print('rembg', rembg.__version__, 'imported ok')"; \
    fi

# ===== LAYER 4: faster-whisper (transcript AI local) ~200 MB =====
# CPU-only — runs Whisper for "Trích lời" without OpenAI API.
ARG INSTALL_WHISPER=1
RUN if [ "$INSTALL_WHISPER" = "1" ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages faster-whisper \
      && python3 -c "from faster_whisper import WhisperModel; print('whisper ok')"; \
    fi

# ===== LAYER 5: PyTorch CPU (~700 MB) — base for Demucs/LaMa/YOLO =====
# One torch install reused by all 3 heavy features. INSTALL_TORCH defaults on; turn off
# if all of Demucs/LaMa/YOLO are disabled to skip the download.
ARG INSTALL_TORCH=1
RUN if [ "$INSTALL_TORCH" = "1" ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages \
        --index-url https://download.pytorch.org/whl/cpu \
        torch==2.4.1 torchaudio==2.4.1 \
      && python3 -c "import torch; print('torch', torch.__version__, 'cpu')"; \
    fi

# ===== LAYER 6: Demucs (Tách stems audio AI) ~400 MB (needs torch) =====
ARG INSTALL_DEMUCS=1
RUN if [ "$INSTALL_DEMUCS" = "1" ] && [ "$INSTALL_TORCH" = "1" ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages demucs \
      && demucs --help > /dev/null; \
    fi

# ===== LAYER 7: iopaint LaMa/LDM (Xoá vật thể PRIMARY engine) ~500 MB =====
# This is the main inpaint engine for "Xoá vật thể". Without it, xoá vật thể falls
# back to cv2 (lower quality). simple-lama-inpainting added as lighter fallback.
# iopaint pulls gradio+fastapi as transitive deps for its server mode; we don't
# use that here, so we only verify the model_manager Python import (no CLI/gradio
# init triggered) which is what server-side code actually uses.
ARG INSTALL_INPAINT=1
RUN if [ "$INSTALL_INPAINT" = "1" ] && [ "$INSTALL_TORCH" = "1" ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages \
        simple-lama-inpainting iopaint \
      && python3 -c "from simple_lama_inpainting import SimpleLama; print('simple-lama imported')" \
      && python3 -c "from iopaint.model_manager import ModelManager; print('iopaint.model_manager imported')"; \
    fi

# ===== LAYER 8: ultralytics YOLOv8 (Smart object detect for Xoá vật thể) ~200 MB =====
ARG INSTALL_YOLO=1
RUN if [ "$INSTALL_YOLO" = "1" ] && [ "$INSTALL_TORCH" = "1" ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages ultralytics \
      && python3 -c "from ultralytics import YOLO; print('YOLOv8 ok')"; \
    fi

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV CORS_ORIGIN=*
# Render sets PORT dynamically; respect it but default to 8080 for local docker run.

COPY package*.json ./
RUN npm ci --omit=dev

# Compiled JS (server + client static files served from dist/client)
COPY --from=build /app/dist ./dist

# Python helper scripts called via subprocess from server (inpaint, detect-objects, OCR)
COPY scripts ./scripts

# Pre-create downloads dir for job outputs. NOTE: Render free has ephemeral disk —
# files lost on container restart. Use a persistent disk + DOWNLOAD_DIR env if needed.
RUN mkdir -p downloads

EXPOSE 8080

CMD ["node", "dist/server/server/server.js"]
