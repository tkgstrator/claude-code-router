import { createHash, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { arch, homedir } from "os";
import { createRequire } from "module";
import { join } from "path";

// Identify as the official Codex CLI. The ChatGPT backend classifies a
// request as "CLI" (subscription allotment) vs "Other" (overage) by
// these markers; without them codex requests bill as Other and skip the
// CLI path.
//
// A standalone (non-editor) `codex exec` sends:
//   codex_exec/<ver> (<os> <ver>; <arch>)
// We deliberately omit the `vscode/...` editor suffix the capture had:
// CCR is a server, not running inside VS Code, and `code` is absent
// from the production image anyway. Version source order: CODEX_CLI_VERSION
// env (lets prod pin it if @openai/codex is ever pruned) -> the installed
// @openai/codex package -> "0.0.0". Resolved once at boot; never throws.
const CODEX_USER_AGENT: string = (() => {
  const safe = (fn: () => string, fallback: string): string => {
    try {
      const v = fn().trim();
      return v.length > 0 ? v : fallback;
    } catch {
      return fallback;
    }
  };
  const codexVer =
    (process.env.CODEX_CLI_VERSION ?? "").trim() ||
    safe(
      () => createRequire(import.meta.url)("@openai/codex/package.json").version,
      "0.0.0"
    );
  const osStr = safe(() => {
    const rel = readFileSync("/etc/os-release", "utf-8");
    const name = rel.match(/^NAME="?([^"\n]+)"?/m)?.[1] ?? "Linux";
    const ver = rel.match(/^VERSION_ID="?([^"\n]+)"?/m)?.[1] ?? "";
    return `${name} ${ver}`.trim();
  }, "Linux");
  return `codex_cli/${codexVer} (${osStr}; ${arch()})`;
})();

const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

function readCodexAuth(): { token: string; accountId?: string } {
  let data: CodexAuthFile;
  try {
    data = JSON.parse(readFileSync(CODEX_AUTH_PATH, "utf-8"));
  } catch {
    throw new Error(
      `Cannot read Codex credentials from ${CODEX_AUTH_PATH}. ` +
        "Authenticate the Codex CLI first."
    );
  }
  const token = data.tokens?.access_token;
  if (!token) {
    throw new Error("Codex credentials are missing tokens.access_token");
  }
  return { token, accountId: data.tokens?.account_id };
}

// ChatGPT-subscription auth for the codex provider.
//
// Unlike claude-code (Anthropic in, Anthropic out — a passthrough that
// only needs an auth header), codex is OpenAI Responses-API style and
// talks to the ChatGPT backend. So it runs the full transform chain
// (anthropic endpoint transformer -> openai-responses) and this
// transformer sits LAST in the provider's `use` list: openai-responses
// has already reshaped the body to Responses format, and we add the
// subscription auth + the chatgpt.com/backend-api/codex requirements.
//
// The llms `auth()` hook only fires in passthrough/bypass mode, which
// codex can't use, so the credential injection is done here via
// transformRequestIn's returned `config` (merged by the pipeline).
export class CodexCredentialsTransformer {
  name = "codex-oauth";

  async transformRequestIn(request: any, provider: any) {
    const { token, accountId } = readCodexAuth();

    // chatgpt.com/backend-api/codex requires `instructions`, `input`
    // as a list, store=false and stream=true. openai-responses already
    // produced `input` and lifts `instructions` from the system block;
    // enforce the rest (and a non-empty instructions fallback).
    request.store = false;
    request.stream = true;
    if (
      typeof request.instructions !== "string" ||
      request.instructions.length === 0
    ) {
      request.instructions = "You are a helpful assistant.";
    }

    // OpenAI routes its prompt cache by `prompt_cache_key`; the official
    // CLI uses a per-session uuid. This proxy is stateless, so derive a
    // deterministic key from the stable request prefix instead — every
    // turn of the same conversation hashes identically and hits the
    // cache, fixing the prefix being re-billed each turn.
    request.prompt_cache_key = createHash("sha256")
      .update(
        `${request.model ?? ""}\n${request.instructions ?? ""}\n${JSON.stringify(request.tools ?? [])}`
      )
      .digest("hex")
      .slice(0, 32);

    // provider.baseUrl is the codex backend root
    // (https://chatgpt.com/backend-api/codex); the Responses endpoint
    // is one level down. sendRequestToProvider uses config.url verbatim
    // when set, otherwise provider.baseUrl.
    const base = String(provider?.baseUrl ?? "").replace(/\/+$/, "");
    const url = /\/responses$/.test(base) ? base : `${base}/responses`;

    const sessionId = randomUUID();

    return {
      body: request,
      config: {
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "text/event-stream",
          originator: "codex_cli",
          "user-agent": CODEX_USER_AGENT,
          session_id: sessionId,
          thread_id: sessionId,
          "x-client-request-id": randomUUID(),
          "x-codex-beta-features": "terminal_resize_reflow",
          "x-codex-window-id": `${sessionId}:0`,
          ...(accountId ? { "chatgpt-account-id": accountId } : {}),
        },
      },
    };
  }

  // Response chain runs reversed, so this fires BEFORE openai-responses.
  // The ChatGPT codex backend streams a Responses-API SSE body but does
  // NOT send `Content-Type: text/event-stream`. openai-responses (and
  // then the anthropic endpoint transformer) branch on Content-Type and
  // otherwise JSON.parse the body — which throws on "event: response…".
  // Re-tag a successful stream so the SSE branch is taken. Non-2xx
  // bodies are genuine JSON errors; leave them untouched.
  async transformResponseOut(response: Response) {
    if (!response.ok) return response;
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) return response;
    const headers = new Headers(response.headers);
    headers.set("content-type", "text/event-stream");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
