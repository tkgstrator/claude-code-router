/**
 * Shared helpers for provider integration tests.
 * Tests call the running CCR server with Anthropic-format bodies.
 * Using "provider,model" in the model field routes directly to that provider.
 *
 * Base URL defaults to the consolidated Vite+Hono dev server
 * (http://127.0.0.1:16173); override with CCR_TEST_URL for a different
 * host/port.
 */

const CCR_BASE = process.env.CCR_TEST_URL ?? "http://127.0.0.1:16173";
export const CCR_URL = `${CCR_BASE}/v1/messages`;
export const CCR_CONFIG_URL = `${CCR_BASE}/api/config`;
export const TEST_TIMEOUT = 60_000;

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
  const res = await fetch(CCR_CONFIG_URL);
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
const GENERIC_RATE_LIMIT = /\b429\b|rate_limit|rate limit/i;
const QUOTA_RETRY_DELAY_MS = 8_000;

export type SmokeOutcome =
  | { kind: "ok"; text: string }
  | { kind: "skipped-quota"; message: string };

/**
 * Smoke one subscription model end-to-end. Returns "ok" with the
 * streamed text, or "skipped-quota" when the provider is genuinely
 * throttling.
 *
 * A long-context 429 ("Extra usage is required for long context
 * requests") is NEVER tolerated — it's rethrown so the test fails. That
 * is the regression guard for the context-1m beta strip on
 * subscription routing.
 *
 * A generic quota 429 is retried once after a short cooldown (rapid
 * back-to-back model probes briefly trip the subscription's
 * throughput limit even though each call is tiny); only a *sustained*
 * quota 429 downgrades to skip, so the matrix actually verifies models
 * instead of skipping them on transient throttle.
 */
export async function smokeSubscriptionModel(model: string): Promise<SmokeOutcome> {
  const attempt = async (): Promise<string> => {
    const res = await sendMessage({
      model,
      max_tokens: 64,
      messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
      stream: true,
    });
    // A healthy streamed Anthropic completion is exactly HTTP 200.
    // Assert it explicitly (stricter than res.ok, which would accept
    // any 2xx) and surface the status + body so the 429 classifier
    // below can tell a long-context gate from a generic quota limit.
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const events = await parseSSEStream(res);
    assertAnthropicSSEShape(events);
    return extractTextFromEvents(events);
  };

  for (let i = 0; i < 2; i++) {
    try {
      return { kind: "ok", text: await attempt() };
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (LONG_CONTEXT_GATE.test(message)) {
        throw new Error(
          `${model}: long-context 429 regressed — context-1m beta is reaching Anthropic again. ${message}`
        );
      }
      if (!GENERIC_RATE_LIMIT.test(message)) throw err;
      if (i === 0) {
        await new Promise((r) => setTimeout(r, QUOTA_RETRY_DELAY_MS));
        continue;
      }
      return { kind: "skipped-quota", message };
    }
  }
  return { kind: "skipped-quota", message: `${model}: exhausted quota retries` };
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  stream?: boolean;
  system?: string;
}

export interface SSEEvent {
  event: string;
  data: unknown;
}

/** Send a request to CCR and return the raw Response. */
export async function sendMessage(body: AnthropicRequest): Promise<Response> {
  const res = await fetch(CCR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "test",
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
