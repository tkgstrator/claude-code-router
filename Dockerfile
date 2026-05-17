# Production image for the consolidated Vite + Hono app.
#
# Build the single-file SPA with Vite at image-build time, then serve
# it at runtime with Bun directly running the Hono app — NO Vite at
# runtime. src/server.ts imports the same Hono app as src/index.ts and
# adds a static + index.html fallback for every non-API route (the job
# @hono/vite-dev-server did in dev).
FROM oven/bun:1

WORKDIR /app

# --- Sources required to install + build + run -----------------------
# Order matters: prisma.config.ts + src/prisma/schema.prisma must be in
# place BEFORE `bun install`, because package.json's `postinstall` runs
# `prisma generate`, which reads them and emits src/generated/prisma.
COPY package.json bun.lock ./
COPY tsconfig.json tsconfig.base.json tsconfig.runtime.json biome.json ./
COPY index.html vite.config.ts prisma.config.ts ./
COPY packages ./packages
COPY scripts ./scripts
COPY src ./src

# Installs deps and runs `postinstall` -> `prisma generate`
# (schema is already present above, so the client is generated here).
RUN bun install --frozen-lockfile

# Belt-and-suspenders: ensure the Prisma client exists even if the
# postinstall lifecycle was skipped for any reason.
RUN bunx prisma generate

# Builds @ccr/shared and the single-file SPA -> dist/index.html, which
# src/server.ts serves as the static + SPA fallback.
RUN bun run build

# Entrypoint: apply pending Prisma migrations BEFORE the server boots.
# The full rationale lives in entrypoint.sh; in short, src/index.ts
# runs bootstrapServer() at import time and requires the schema to
# already exist, so `prisma migrate deploy` must run first. Tracked as
# a real repo file instead of being generated in-image via printf.
COPY entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# DATABASE_URL and REDIS_URL are injected by compose at runtime.
# The server binds the port the config envelope resolves to (default
# 3456, mirrored onto process.env.PORT by bootstrap; see
# src/server.ts). Bun binds 0.0.0.0. Operators changing the envelope
# PORT must publish that port instead.
EXPOSE 3456

# Liveness probe against the SPA root (no dedicated /health route).
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:3456/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The production server: Bun runs the Hono app + SPA fallback. No Vite.
# --tsconfig-override swaps in tsconfig.runtime.json so `@/llms/*`
# resolves to real source instead of the tsc-only .d.ts stub (see
# tsconfig.runtime.json + src/server.ts for the full rationale). The
# flag is a Bun *runtime* flag, so it precedes the entry file and
# there is no `run` subcommand.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "--tsconfig-override", "tsconfig.runtime.json", "src/server.ts"]
