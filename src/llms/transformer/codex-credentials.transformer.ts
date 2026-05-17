import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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
  name = "codex-credentials";

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

    // provider.baseUrl is the codex backend root
    // (https://chatgpt.com/backend-api/codex); the Responses endpoint
    // is one level down. sendRequestToProvider uses config.url verbatim
    // when set, otherwise provider.baseUrl.
    const base = String(provider?.baseUrl ?? "").replace(/\/+$/, "");
    const url = /\/responses$/.test(base) ? base : `${base}/responses`;

    return {
      body: request,
      config: {
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
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
