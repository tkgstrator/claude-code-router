/**
 * Shared helpers for provider integration tests.
 * Tests call CCR at http://127.0.0.1:3456/v1/messages with Anthropic-format bodies.
 * Using "provider,model" in the model field routes directly to that provider.
 */

export const CCR_URL = "http://127.0.0.1:3456/v1/messages";
export const TEST_TIMEOUT = 60_000;

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
