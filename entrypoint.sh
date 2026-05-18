#!/bin/sh
# Container entrypoint: apply pending Prisma migrations BEFORE the
# server boots.
#
# src/index.ts runs bootstrapServer() at module load, which seeds the
# DB and therefore requires the schema to already exist. Against an
# unmigrated database it throws P2021 ("table does not exist") and the
# process exits. `prisma migrate deploy` is the production-safe,
# idempotent command (no prompts, applies only already-generated
# migrations); running it again is a no-op.
#
# `set -e` makes a failed migration abort the container instead of
# starting the server against a half-migrated schema. compose.yaml
# already gates this on `postgres: condition: service_healthy`.
set -e

# The @openai/codex dev package is not in the runtime image, so its
# version is baked at build time; codex-credentials reads it via this
# env (falls back internally if unset).
if [ -f /app/.codex-cli-version ]; then
  CODEX_CLI_VERSION="$(cat /app/.codex-cli-version)"
  export CODEX_CLI_VERSION
fi

# The prisma CLI is dev-only and not installed in this lean image.
# Fetch it on demand, pinned to the @prisma/client version that IS
# present, so the migration engine matches the generated client
# instead of bunx silently pulling a newer prisma.
PRISMA_VERSION="$(bun -e "process.stdout.write(require('@prisma/client/package.json').version)" 2>/dev/null || true)"
if [ -n "$PRISMA_VERSION" ]; then
  PRISMA_PKG="prisma@$PRISMA_VERSION"
else
  PRISMA_PKG="prisma"
fi

echo "[entrypoint] applying prisma migrations (migrate deploy via $PRISMA_PKG)..."
bunx "$PRISMA_PKG" migrate deploy
echo "[entrypoint] migrations applied; starting server"

exec "$@"
