FROM node:20-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg fontconfig python3 python3-pip libreoffice-writer libreoffice-calc fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk \
  && python3 -m pip install --no-cache-dir --break-system-packages --upgrade yt-dlp pdf2docx \
  && python3 -m yt_dlp --version \
  && pdf2docx --help >/dev/null \
  && fc-cache -f \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

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
