#!/usr/bin/env bash
# Start mitmproxy capture session for Claude Code and Codex traffic.
#
# Captured files land in ./captures/ (gitignored):
#   captures/session.flows               — mitmproxy native format (replay with mitmweb)
#   captures/<slug>.<hash>/{request.json, response.json, response.body}
#
# Usage:
#   bash scripts/start-capture.sh
#
# Then, in a separate terminal, run Claude Code or Codex through the proxy:
#   source <(bash scripts/proxy-env.sh)
#   claude           # or: codex

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CAPTURES_DIR="${CAPTURES_DIR:-$REPO_ROOT/captures}"
FLOWS_FILE="$CAPTURES_DIR/session.flows"
MITM_PORT="${MITM_PORT:-8080}"
CA_CERT="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"

mkdir -p "$CAPTURES_DIR"

# Generate the CA certificate on first run (mitmdump --version triggers init).
if [[ ! -f "$CA_CERT" ]]; then
  echo "Generating mitmproxy CA certificate..."
  mitmdump --version > /dev/null 2>&1 || true
  # run briefly to generate certs
  timeout 2 mitmdump -p "$MITM_PORT" 2>/dev/null || true
fi

if [[ ! -f "$CA_CERT" ]]; then
  echo "ERROR: CA cert not found at $CA_CERT after init. Run 'mitmdump' once manually."
  exit 1
fi

echo "=========================================="
echo " mitmproxy capture session"
echo "=========================================="
echo " Proxy:    http://127.0.0.1:${MITM_PORT}"
echo " CA cert:  $CA_CERT"
echo " Captures: $CAPTURES_DIR"
echo " Flows:    $FLOWS_FILE"
echo ""
echo " In another terminal, run:"
echo "   source <(bash $SCRIPT_DIR/proxy-env.sh)"
echo "   claude     # Claude Code"
echo "   codex      # Codex CLI"
echo ""
echo " Press Ctrl+C to stop."
echo "=========================================="
echo ""

export CAPTURES_DIR

exec mitmdump \
  -p "$MITM_PORT" \
  -s "$SCRIPT_DIR/mitm_capture.py" \
  --save-stream-file "$FLOWS_FILE" \
  --ssl-insecure
