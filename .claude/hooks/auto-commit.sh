#!/bin/sh
# Stop hook: auto-commit when the working tree is "green".
#
# Flow:
#   1. bail if nothing changed
#   2. never auto-commit onto a protected branch (branch-first rule)
#   3. run the project gate (commit-gate.sh) — skip the commit if it fails. All
#      language/stack-specific checks (Biome, tsc, …) live there, not here, so this
#      script stays generic and reusable across projects.
#   4. stage everything, ask an LLM for a Conventional Commits header derived
#      from the diff, then commit with the repo's local git identity
#
# Constraints baked in (project memory):
#   - subject in English, starts lowercase (avoids commitlint subject-case)
#   - type is restricted to the project's commitlint type-enum
#   - header <= 96 chars (header-max-length)
set -u

# Guard against recursion: the `claude -p` call below is itself a Claude run
# whose own Stop hook would re-enter this script. The env var short-circuits it.
[ -n "${AUTO_COMMIT_NESTED:-}" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0

# 1. nothing to do?
[ -z "$(git status --porcelain)" ] && exit 0

# 2. protected branches: report and stop (commit must go on a feature branch)
branch="$(git branch --show-current)"
case "$branch" in
  master | main | develop | "")
    echo "auto-commit: skipped on protected branch '${branch:-detached HEAD}'" >&2
    exit 0
    ;;
esac

# 3. project gate — do not commit a red tree. The stack-specific checks live in
#    commit-gate.sh (swappable per project); if it is absent, proceed ungated.
gate="$(dirname "$0")/commit-gate.sh"
if [ -x "$gate" ] && ! "$gate"; then
  echo "auto-commit: skipped — commit-gate failed" >&2
  exit 0
fi

# 4. stage and build the diff context for the LLM
git add -A
[ -z "$(git diff --staged --name-only)" ] && exit 0
diff="$(git diff --staged --stat; printf '\n----\n'; git diff --staged --unified=0 | head -n 400)"

prompt="Write ONE git commit message for the staged diff below.
Hard rules (all must hold):
- Conventional Commits header: <type>(<optional-scope>): <subject>
- type is EXACTLY one of: build ui ci docs feat fix perf refactor revert format test chore
- subject and body in English
- subject starts lowercase (never a capitalized English word), no trailing period
- header (type+scope+subject) is at most 96 characters
- Output ONLY the commit message: header line, then an optional blank line and a short body.
- No code fences, no preamble, no commentary.

Staged diff:
$diff"

msg="$(printf '%s' "$prompt" | AUTO_COMMIT_NESTED=1 claude -p --model claude-haiku-4-5-20251001 2>/dev/null)"
# drop code fences / leading blank lines the model may add
msg="$(printf '%s\n' "$msg" | sed '/^```/d')"
header="$(printf '%s\n' "$msg" | sed '/^[[:space:]]*$/d' | head -n 1)"

# fallback if the LLM gave nothing usable, or the message fails the repo's commitlint
fallback=''
[ -z "$header" ] && fallback=1
if [ -z "$fallback" ] && ls .commitlintrc* commitlint.config.* >/dev/null 2>&1; then
  printf '%s\n' "$msg" | bunx --bun commitlint >/dev/null 2>&1 || fallback=1
fi
if [ -n "$fallback" ]; then
  files="$(git diff --staged --name-only | head -n 3 | tr '\n' ' ')"
  msg="chore: update ${files}"
fi

# 5. commit with the repo's local git identity + Claude trailer
printf '%s\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\n' "$msg" \
  | git commit -F - >/tmp/auto-commit.log 2>&1 \
  && echo "auto-commit: committed on '$branch' — $(git log -1 --pretty=%s)" >&2 \
  || { echo "auto-commit: git commit failed" >&2; tail -20 /tmp/auto-commit.log >&2; }
exit 0
