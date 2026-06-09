#!/bin/sh
# Stop hook (report-only): show the repo's green-state — Biome + tsc + tests.
# Never fails the turn; output is surfaced back to the session.
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0

bunx --bun @biomejs/biome check --no-errors-on-unmatched . 2>&1 | tail -40
[ -f tsconfig.json ] && bunx tsc -b --noEmit 2>&1 | tail -40
bun test 2>&1 | tail -40
true
