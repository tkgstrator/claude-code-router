#!/bin/sh
# Project-specific pre-commit gate, called by auto-commit.sh.
#   exit 0      → green, safe to auto-commit
#   exit non-0  → do NOT auto-commit (a check failed)
#
# This is the LANGUAGE-SPECIFIC piece of the auto-commit pipeline — keep all
# stack-dependent checks here so auto-commit.sh stays generic and reusable across
# projects (TS, Dart, Go, …). Swap or extend this file per project.
#
# This version targets a TypeScript + Biome repo, but each check is guarded by a
# config-file probe, so it is a safe no-op in a project that lacks them.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0

# Biome (only if the repo is configured for it)
if [ -f biome.json ] || [ -f biome.jsonc ]; then
  if ! bunx --bun @biomejs/biome check --no-errors-on-unmatched . >/tmp/commit-gate-biome.log 2>&1; then
    echo "commit-gate: biome check failed" >&2
    tail -20 /tmp/commit-gate-biome.log >&2
    exit 1
  fi
fi

# TypeScript (only if there is a tsconfig)
if [ -f tsconfig.json ]; then
  if ! bunx tsc -b --noEmit >/tmp/commit-gate-tsc.log 2>&1; then
    echo "commit-gate: tsc failed" >&2
    tail -20 /tmp/commit-gate-tsc.log >&2
    exit 1
  fi
fi

exit 0
