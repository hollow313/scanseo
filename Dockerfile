# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

########## étape 1 : dépendances compilées (better-sqlite3 sur musl)
FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache build-base python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

########## étape 2 : image finale
FROM node:${NODE_VERSION}-alpine AS runtime

RUN apk add --no-cache \
      chromium nss freetype harfbuzz ca-certificates tzdata curl \
      font-noto ttf-dejavu \
 && addgroup -g 568 apps \
 && adduser -D -u 568 -G apps -h /app -s /sbin/nologin apps

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Europe/Paris \
    DATA_DIR=/data \
    REPORTS_DIR=/reports \
    CONTENT_DIR=/content

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=568:568 . .
RUN chmod 755 /app/entrypoint.sh \
 && mkdir -p /data /reports /content \
 && chown -R 568:568 /data /reports /content /app

USER 568:568
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz >/dev/null || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
