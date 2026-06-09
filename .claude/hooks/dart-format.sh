#!/bin/sh
# PostToolUse(Write|Edit|MultiEdit) hook.
# Run `dart format` on the file that was just written/edited, if it is Dart.
f="$(jq -r '.tool_response.filePath // .tool_input.file_path')"
case "$f" in
  *.dart) dart format "$f" 2>/dev/null ;;
esac
exit 0
