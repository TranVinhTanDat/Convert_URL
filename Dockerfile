FROM node:20-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg fontconfig python3 python3-pip libreoffice-writer libreoffice-calc tesseract-ocr tesseract-ocr-eng tesseract-ocr-vie ghostscript pngquant unpaper qpdf fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk \
  && python3 -m pip install --no-cache-dir --break-system-packages --upgrade yt-dlp pdf2docx pymupdf pytesseract pillow python-docx opencv-contrib-python-headless ocrmypdf \
  && python3 -m yt_dlp --version \
  && pdf2docx --help >/dev/null \
  && tesseract --version >/dev/null \
  && ocrmypdf --version >/dev/null \
  && python3 -c "import fitz, pytesseract, docx, PIL; print('scan OCR ready')" \
  && python3 -c "import cv2; print('cv2', cv2.__version__, 'xphoto:', hasattr(cv2, 'xphoto'))" \
  && fc-cache -f \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Demucs (audio stem separation) — installed in a separate layer because torch is large (~700 MB).
# Set INSTALL_DEMUCS=0 at build time to skip if you don't need the "Tách 4 stems" feature.
ARG INSTALL_DEMUCS=1
RUN if [ "$INSTALL_DEMUCS" = "1" ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages \
        --index-url https://download.pytorch.org/whl/cpu \
        torch==2.4.1 torchaudio==2.4.1 \
      && python3 -m pip install --no-cache-dir --break-system-packages demucs \
      && demucs --help > /dev/null; \
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

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p downloads

EXPOSE 8080

CMD ["node", "dist/server/server/server.js"]
