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

# prisma is a runtime dependency (installed locally; prisma.config.ts
# imports `prisma/config`), so this resolves the local, lockfile-pinned
# CLI — no network fetch.
echo "[entrypoint] applying prisma migrations (migrate deploy)..."
bunx prisma migrate deploy
echo "[entrypoint] migrations applied; starting server"

exec "$@"
