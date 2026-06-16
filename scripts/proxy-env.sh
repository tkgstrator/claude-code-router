#!/usr/bin/env bash
# Print environment variables needed to route Claude Code / Codex through
# the local mitmproxy capture session.
#
# Usage:
#   source <(bash scripts/proxy-env.sh)
#
# Then run:
#   claude     # Claude Code (api.anthropic.com)
#   codex      # Codex CLI  (api.openai.com)

MITM_PORT="${MITM_PORT:-8080}"
CA_CERT="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"

if [[ ! -f "$CA_CERT" ]]; then
  echo "# ERROR: $CA_CERT not found. Start the capture session first:" >&2
  echo "#   bash scripts/start-capture.sh" >&2
  exit 1
fi

echo "export HTTPS_PROXY=http://127.0.0.1:${MITM_PORT}"
echo "export HTTP_PROXY=http://127.0.0.1:${MITM_PORT}"
# Node.js (used by claude and codex CLIs) needs this to trust the MITM cert.
echo "export NODE_EXTRA_CA_CERTS=$CA_CERT"
# Python-based tools (if any) also need this.
echo "export REQUESTS_CA_BUNDLE=$CA_CERT"
echo "export SSL_CERT_FILE=$CA_CERT"
echo ""
echo "echo 'Proxy env set. Traffic to api.anthropic.com and api.openai.com will be captured.'"
