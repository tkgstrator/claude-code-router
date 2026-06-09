#!/bin/sh
# PostToolUse(Write|Edit|MultiEdit) hook.
# Auto-fix the file that was just written/edited with Biome.
# Receives the tool-call JSON on stdin; pulls out the file path.
f="$(jq -r '.tool_response.filePath // .tool_input.file_path')"
[ -n "$f" ] && [ "$f" != "null" ] \
  && bunx --bun @biomejs/biome check --write --no-errors-on-unmatched "$f" 2>/dev/null
exit 0
