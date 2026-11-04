FROM node:22-bookworm-slim

ARG BGUTIL_VERSION=2.0.2

# ffmpeg + python (yt-dlp) + git + libs needed by the PO-token provider (node-canvas)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates curl git \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
 && pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" "bgutil-ytdlp-pot-provider==${BGUTIL_VERSION}" \
 && rm -rf /var/lib/apt/lists/*

# PO-token provider (HTTP server on 127.0.0.1:4416, picked up automatically by the yt-dlp plugin)
RUN git clone --single-branch --branch ${BGUTIL_VERSION} https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
 && cd /opt/bgutil/server \
 && npm ci \
 && npx tsc

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN chmod +x /app/docker-start.sh

ENV NODE_ENV=production \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

EXPOSE 3000
CMD ["/app/docker-start.sh"]
