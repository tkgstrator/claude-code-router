"""
mitmproxy addon — capture Claude Code and Codex API traffic to disk.

Saves each intercepted request/response pair in two formats:
  1. JSON pair  →  captures/<slug>.<hash16>/{request.json, response.json, response.body}
  2. Native .flows file (written by mitmproxy itself via --save-stream-file)

Target hosts:
  api.anthropic.com  — Claude Code (HTTP)
  api.openai.com     — OpenAI API (HTTP)
  chatgpt.com        — Codex CLI (WebSocket: /backend-api/codex/responses)

Usage (from repo root):
  mitmdump -s scripts/mitm_capture.py --save-stream-file captures/session.flows

Then in another terminal start Claude Code or Codex through the proxy:
  HTTPS_PROXY=http://127.0.0.1:8080 NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem claude
  HTTPS_PROXY=http://127.0.0.1:8080 NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem codex
"""

import hashlib
import json
import os
import re
import time
from pathlib import Path

from mitmproxy import http

CAPTURES_DIR = Path(os.environ.get("CAPTURES_DIR", Path(__file__).parent.parent / "captures"))

TARGET_HOSTS = {"api.anthropic.com", "api.openai.com", "chatgpt.com"}

# WebSocket paths on chatgpt.com that carry Codex traffic.
WS_CAPTURE_PATHS = {"/backend-api/codex/responses"}

# Headers that carry wire-transfer metadata and would lie when replayed.
STRIP_RESPONSE_HEADERS = {
    "connection", "keep-alive", "transfer-encoding",
    "content-encoding", "content-length", "te", "trailer",
    "upgrade", "proxy-authenticate", "proxy-authorization",
}


def _hash16(method: str, url: str, body: object) -> str:
    canon = json.dumps({"method": method, "url": url, "body": body}, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()[:16]


def _slug(host: str, path: str, body: object) -> str:
    if "anthropic" in host:
        prefix = "claude-code"
    elif "chatgpt" in host:
        prefix = "codex-ws"
    elif "openai" in host:
        prefix = "codex"
    else:
        prefix = host.split(".")[0]

    model = ""
    if isinstance(body, dict):
        raw = str(body.get("model", ""))
        model = raw.replace("/", "-").replace(",", "-").replace(".", "-")

    endpoint = path.strip("/").replace("/", "-") or "root"

    parts = [p for p in [prefix, endpoint, model] if p]
    raw_slug = "-".join(parts)
    raw_slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw_slug)
    raw_slug = re.sub(r"-+", "-", raw_slug).strip("-")
    return raw_slug[:100]


def response(flow: http.HTTPFlow) -> None:
    if flow.request.pretty_host not in TARGET_HOSTS:
        return

    method = flow.request.method
    url = f"https://{flow.request.pretty_host}{flow.request.path}"

    # Parse request body
    raw_req = flow.request.get_text(strict=False) or ""
    try:
        parsed_body: object = json.loads(raw_req) if raw_req.strip() else None
    except (json.JSONDecodeError, ValueError):
        parsed_body = raw_req or None

    slug = _slug(flow.request.pretty_host, flow.request.path, parsed_body)
    h = _hash16(method, url, parsed_body)
    out_dir = CAPTURES_DIR / f"{slug}.{h}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # --- request.json ---
    req_headers = {
        k.lower(): ("***REDACTED***" if k.lower() in {"x-api-key", "authorization", "cookie"} else v)
        for k, v in flow.request.headers.items()
        if k.lower() not in {"host", "accept-encoding", "content-length"}
    }
    (out_dir / "request.json").write_text(
        json.dumps(
            {"label": slug, "method": method, "url": url, "headers": req_headers, "body": parsed_body},
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    # --- response.json ---
    resp_headers = {
        k.lower(): v
        for k, v in flow.response.headers.items()
        if k.lower() not in STRIP_RESPONSE_HEADERS
    }
    (out_dir / "response.json").write_text(
        json.dumps(
            {
                "status": flow.response.status_code,
                "statusText": flow.response.reason or "",
                "headers": resp_headers,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    # --- response.body ---
    resp_body = flow.response.get_text(strict=False) or ""
    (out_dir / "response.body").write_text(resp_body, encoding="utf-8")

    size = len(resp_body)
    print(f"[saved] {method} {flow.request.pretty_host}{flow.request.path}  →  {slug}.{h}/  ({size} B)")


# ---------------------------------------------------------------------------
# WebSocket capture — Codex uses chatgpt.com WebSocket
#
# Directory layout:
#   captures/<slug>.<hash>/
#     request.json      WebSocket upgrade request metadata
#     messages.jsonl    One JSON object per line:
#                         {"ts": <unix float>, "from_client": bool, "content": <str>}
#     messages_server.jsonl   Server-only messages (convenience subset)
# ---------------------------------------------------------------------------

# flow id → out_dir  (populated on websocket_start, consumed across messages)
_ws_dirs: dict[str, Path] = {}


def websocket_start(flow: http.HTTPFlow) -> None:
    if flow.request.pretty_host not in TARGET_HOSTS:
        return
    path = flow.request.path.split("?")[0]
    if "chatgpt" in flow.request.pretty_host and path not in WS_CAPTURE_PATHS:
        return

    url = f"wss://{flow.request.pretty_host}{flow.request.path}"
    slug = _slug(flow.request.pretty_host, flow.request.path, None)
    h = _hash16("WS", url, None)
    out_dir = CAPTURES_DIR / f"{slug}.{h}"
    out_dir.mkdir(parents=True, exist_ok=True)
    _ws_dirs[flow.id] = out_dir

    (out_dir / "request.json").write_text(
        json.dumps(
            {
                "label": slug,
                "method": "WS",
                "url": url,
                "headers": dict(flow.request.headers),
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"[ws-start] {flow.request.pretty_host}{flow.request.path}  →  {slug}.{h}/")


def websocket_message(flow: http.HTTPFlow) -> None:
    out_dir = _ws_dirs.get(flow.id)
    if out_dir is None:
        return

    msg = flow.websocket.messages[-1]  # type: ignore[union-attr]
    from_client: bool = msg.from_client
    # content is always bytes per mitmproxy spec
    content = msg.content.decode("utf-8", errors="replace")

    entry = json.dumps(
        {"ts": time.time(), "from_client": from_client, "content": content},
        ensure_ascii=False,
    )

    with open(out_dir / "messages.jsonl", "a", encoding="utf-8") as f:
        f.write(entry + "\n")

    if not from_client:
        with open(out_dir / "messages_server.jsonl", "a", encoding="utf-8") as f:
            f.write(entry + "\n")

    direction = "→" if from_client else "←"
    print(f"[ws-msg]  {direction} {len(content)} B  ({out_dir.name})")


def websocket_end(flow: http.HTTPFlow) -> None:
    out_dir = _ws_dirs.pop(flow.id, None)
    if out_dir is None:
        return
    n_total = sum(1 for _ in open(out_dir / "messages.jsonl", encoding="utf-8")) if (out_dir / "messages.jsonl").exists() else 0
    print(f"[ws-end]  {out_dir.name}  ({n_total} messages)")
