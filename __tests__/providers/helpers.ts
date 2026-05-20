/**
 * Shared helpers for provider integration tests.
 *
 * By default the suite runs in *replay* mode against fixtures captured
 * via `scripts/capture-fixtures.ts` — no live server needed. Set
 * `CCR_FIXTURE_MODE=live` to bypass fixtures and hit the running CCR
 * server (default http://127.0.0.1:16173, override with CCR_TEST_URL).
 * "provider,model" routing in the body still applies in either mode.
 */

import { FIXTURE_MODE, cachedFetch } from "./fixtures";

const CCR_BASE = process.env.CCR_TEST_URL ?? "http://127.0.0.1:16173";
const CCR_APIKEY = process.env.CCR_TEST_APIKEY ?? "test";
export const CCR_URL = `${CCR_BASE}/v1/messages`;
export const CCR_CONFIG_URL = `${CCR_BASE}/api/config`;
export const TEST_TIMEOUT = 60_000;
export const IS_REPLAY = FIXTURE_MODE === "replay";

export interface SubscriptionModel {
  provider: string;
  model: string;
}

/**
 * Pull the live subscription-provider model matrix from the running
 * server's /api/config (the DB-backed source of truth), so the suite
 * exercises *every* enabled model of a subscription provider instead
 * of a hardcoded handful. `enabled` = listed in the provider's models
 * and not in its transformer._disabledModels. `nameMatch` narrows to a
 * specific subscription provider (e.g. /claude/ or /codex/).
 */
export async function fetchSubscriptionModels(
  nameMatch: RegExp
): Promise<SubscriptionModel[]> {
  const res = await cachedFetch(CCR_CONFIG_URL, { headers: { "x-api-key": CCR_APIKEY } });
  if (!res.ok) throw new Error(`GET /api/config -> HTTP ${res.status}`);
  const cfg = (await res.json()) as {
    Providers?: {
      name: string;
      auth_mode?: string;
      models?: string[];
      transformer?: { _disabledModels?: string[] };
    }[];
  };
  const out: SubscriptionModel[] = [];
  for (const p of cfg.Providers ?? []) {
    if (p.auth_mode !== "subscription") continue;
    if (!nameMatch.test(p.name)) continue;
    const disabled = new Set(p.transformer?._disabledModels ?? []);
    for (const m of p.models ?? []) {
      if (!disabled.has(m)) out.push({ provider: p.name, model: m });
    }
  }
  return out;
}

const LONG_CONTEXT_GATE = /extra usage is required for long context|long context request/i;

/**
 * Smoke one subscription model end-to-end and return the streamed
 * text. ANY non-200 — including a 429 — is a hard failure: a
 * subscription model that 429s is not usable, and skipping that would
 * hide a real routing/auth bug (the same plan demonstrably serves
 * these models to the live Claude Code, so a 429 here is never a
 * genuine quota limit). A long-context 429 ("Extra usage is required
 * for long context requests") gets a sharper message — it's the
 * regression guard for the context-1m beta strip on subscription
 * routing — but it still fails like every other 429.
 */
export async function smokeSubscriptionModel(model: string): Promise<string> {
  const res = await sendMessage({
    model,
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
    stream: true,
  });
  if (res.status !== 200) {
    const body = await res.text();
    if (LONG_CONTEXT_GATE.test(body)) {
      throw new Error(
        `${model}: long-context 429 regressed — context-1m beta is reaching Anthropic again. HTTP ${res.status}: ${body}`
      );
    }
    throw new Error(`${model}: HTTP ${res.status}: ${body}`);
  }
  const events = await parseSSEStream(res);
  assertAnthropicSSEShape(events);
  return extractTextFromEvents(events);
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  // Anthropic accepts a plain string or a structured content-block array
  // (text + tool_use + tool_result …). Tests use the string form; the
  // wider type is here so the helpers don't reject richer shapes that
  // future scenarios might need.
  content: string | unknown[];
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  stream?: boolean;
  system?: string;
  // Optional Anthropic features used by the scenario tests. Typed as
  // unknown here so the test surface doesn't have to mirror every
  // upstream schema — CCR forwards these to the upstream provider.
  tools?: unknown[];
  thinking?: { type: "enabled"; budget_tokens: number };
}

export interface SSEEvent {
  event: string;
  data: unknown;
}

/** Send a request to CCR and return the raw Response. */
export async function sendMessage(body: AnthropicRequest): Promise<Response> {
  const res = await cachedFetch(CCR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CCR_APIKEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  return res;
}

/** Parse a complete Anthropic SSE stream into an array of events. */
export async function parseSSEStream(res: Response): Promise<SSEEvent[]> {
  if (!res.body) throw new Error("Response has no body");

  const events: SSEEvent[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  function processLines(chunk: string) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const rawData = line.slice(5).trim();
        try {
          const data = rawData === "[DONE]" ? rawData : JSON.parse(rawData);
          events.push({ event: currentEvent, data });
        } catch {
          events.push({ event: currentEvent, data: rawData });
        }
        currentEvent = "";
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Flush decoder and process any remaining buffered content
      processLines(decoder.decode());
      if (buffer.trim()) processLines("\n");
      break;
    }
    processLines(decoder.decode(value, { stream: true }));
  }

  return events;
}

/** Extract the concatenated text content from an Anthropic SSE stream. */
export function extractTextFromEvents(events: SSEEvent[]): string {
  return events
    .filter((e) => e.event === "content_block_delta")
    .map((e) => {
      const d = e.data as any;
      return d?.delta?.text ?? d?.delta?.partial_json ?? "";
    })
    .join("");
}

/** Send a streaming request and return all SSE events. */
export async function streamMessage(body: Omit<AnthropicRequest, "stream">): Promise<SSEEvent[]> {
  const res = await sendMessage({ ...body, stream: true });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return parseSSEStream(res);
}

/**
 * Heuristic for "this model can't be exercised through CCR right now"
 * — used by individual tests to skip rather than fail. Covers:
 *   - 404 / model_not_found: model isn't registered upstream.
 *   - unsupported_parameter: OpenAI gpt-5.x rejects `max_tokens`; CCR's
 *     openai transformer hasn't been taught to rewrite it to
 *     `max_completion_tokens` yet, so the fixtures lock in a 400.
 *     Drop this branch once that's fixed.
 * Accepts an Error.message OR an HTTP response body.
 */
export function isUnavailableModelSignal(text: string | undefined): boolean {
  if (!text) return false;
  return (
    text.includes("404") ||
    text.includes("model_not_found") ||
    text.includes("unsupported_parameter")
  );
}

/**
 * Check that events contain the minimum expected Anthropic SSE event types.
 * Note: message_stop is omitted — CCR's OpenAI/Gemini transformers may not emit it reliably.
 */
export function assertAnthropicSSEShape(events: SSEEvent[]): void {
  const eventTypes = events.map((e) => e.event);
  const required = ["message_start", "content_block_start", "content_block_delta", "message_delta"];
  for (const type of required) {
    if (!eventTypes.includes(type)) {
      throw new Error(`Missing expected event type: ${type}. Got: ${[...new Set(eventTypes)].join(", ")}`);
    }
  }
}
