#!/bin/sh
# Container entrypoint: apply pending Prisma migrations BEFORE the
# server boots.
#
# src/index.ts runs bootstrapServer() at module load, which seeds the
# DB and therefore requires the schema to already exist. Against an
# unmigrated database it throws P2021 ("table does not exist") and the
# process exits. `prisma migrate deploy` is the production-safe,
# idempotent command (no prompts, applies only already-generated
# migrations); running it again — e.g. an operator or CI invoking it
# explicitly — is a no-op.
#
# `set -e` makes a failed migration abort the container instead of
# starting the server against a half-migrated schema. compose.yaml
# already gates this on `postgres: condition: service_healthy`, so the
# database is reachable by the time this runs.
set -e

echo "[entrypoint] applying prisma migrations (migrate deploy)..."
bunx prisma migrate deploy
echo "[entrypoint] migrations applied; starting server"

exec "$@"
