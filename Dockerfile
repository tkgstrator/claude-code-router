# Production image for the consolidated Vite + Hono app.
#
# Multi-stage: the builder carries devDependencies (vite, prisma CLI,
# @openai/codex, …) to build the SPA + generate the Prisma client; the
# runtime image installs production deps only, so none of that ships.
#
# Runtime executes TS source directly with Bun (no dist server bundle):
# `bun --tsconfig-override tsconfig.runtime.json src/server.ts`, so the
# image still needs src/, the prod node_modules, the built @ccr/shared,
# the generated Prisma client and the Vite SPA dist.

# ---------- builder ----------------------------------------------------
FROM oven/bun:1 AS builder
WORKDIR /app

# Order matters: prisma.config.ts + src/prisma/schema.prisma must be in
# place before `bun install` (package.json postinstall runs
# `prisma generate`).
COPY package.json bun.lock ./
COPY tsconfig.json tsconfig.base.json tsconfig.runtime.json biome.json ./
COPY index.html vite.config.ts prisma.config.ts ./
COPY packages ./packages
COPY scripts ./scripts
COPY src ./src

RUN bun install --frozen-lockfile
RUN bunx prisma generate
RUN bun run build

# Bake the Codex CLI version while @openai/codex (dev-only) is present;
# it is NOT in the runtime image, so codex-credentials reads this via
# CODEX_CLI_VERSION (exported by the entrypoint). Never fail the build.
RUN bun -e "let v='';try{v=require('@openai/codex/package.json').version}catch{};require('fs').writeFileSync('/app/.codex-cli-version',v)"

# ---------- runtime ----------------------------------------------------
FROM oven/bun:1
WORKDIR /app

# Sources + workspace manifests needed to resolve + run.
COPY package.json bun.lock ./
COPY tsconfig.json tsconfig.base.json tsconfig.runtime.json biome.json ./
COPY prisma.config.ts ./
COPY packages ./packages
COPY src ./src

# Production deps only — drops vite, @openai/codex, prisma CLI, biome,
# typescript, playwright, … --ignore-scripts skips the root
# `prisma generate` postinstall (the prisma CLI is dev-only); the
# generated client and built assets are copied from the builder.
RUN bun install --production --frozen-lockfile --ignore-scripts

# Build outputs the production-only install does not reproduce.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/.codex-cli-version ./.codex-cli-version

COPY entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:3456/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "--tsconfig-override", "tsconfig.runtime.json", "src/server.ts"]
