# ===========================
# Stage 1: Build UI
# ===========================
FROM oven/bun:1-alpine AS ui-builder

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/ui/package.json ./packages/ui/

RUN bun install --frozen-lockfile

COPY packages/ui ./packages/ui

WORKDIR /app/packages/ui
RUN bun run build

# ===========================
# Stage 2: Build server
# ===========================
FROM oven/bun:1-alpine AS server-builder

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

RUN bun install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY packages/server ./packages/server

WORKDIR /app/packages/core
RUN bun run build

WORKDIR /app/packages/shared
RUN bun run build

WORKDIR /app/packages/server
RUN bun run build && rm -rf node_modules/.cache

# ===========================
# Stage 3: Production
# ===========================
FROM oven/bun:1-alpine AS production

RUN apk add --no-cache curl

WORKDIR /app

COPY --from=server-builder /app/packages/server/dist ./packages/server/dist
COPY --from=ui-builder /app/packages/ui/dist/. ./packages/server/dist/

RUN mkdir -p /root/.claude-code-router/logs

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://127.0.0.1:3456/health || exit 1

CMD ["bun", "run", "/app/packages/server/dist/index.js"]
