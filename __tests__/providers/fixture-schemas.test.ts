/**
 * Schema validation pass over the captured fixture corpus.
 *
 * For each fixture under `__fixtures__/`:
 *   - SSE bodies are parsed line-by-line and every `data:` payload is
 *     run through the strict AnthropicSSEPayloadSchema discriminated
 *     union.
 *   - Non-streaming JSON bodies are run through AnthropicMessageResponseSchema.
 *   - The /api/config fixture is skipped (it's the CCR config, not an
 *     LLM response, so a separate schema owns it).
 *
 * The schemas in llm-anthropic-sse.dto.ts are intentionally strict —
 * required fields stay required until a fixture proves the field is
 * actually absent in the wild. This test is what surfaces that.
 */

import { describe, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AnthropicErrorResponseSchema,
  AnthropicIncomingRequestHeadersSchema,
  AnthropicIncomingRequestSchema,
  AnthropicMessageResponseSchema,
  AnthropicSSEPayloadSchema,
} from "@/schemas";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

// Some fixtures intentionally lie outside the Anthropic message shape.
// health-* captures health-check endpoints, not LLM responses.
const SKIP_FIXTURE = /^api-config\.|^health-/;

interface ParsedSSE {
  event: string;
  data: unknown;
}

function parseSSE(text: string): ParsedSSE[] {
  const out: ParsedSSE[] = [];
  let currentEvent = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const raw = line.slice(5).trim();
      if (raw === "" || raw === "[DONE]") continue;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        // Capture failed-parse rows so the test surfaces them
        // explicitly instead of silently skipping malformed events.
        data = raw;
      }
      out.push({ event: currentEvent, data });
      currentEvent = "";
    }
  }
  return out;
}

interface FixtureSpec {
  dir: string;
  body: string;
  contentType: string | undefined;
  requestBody: unknown;
  requestHeaders: Record<string, string> | undefined;
  requestMethod: string;
}

function loadFixtures(): FixtureSpec[] {
  const out: FixtureSpec[] = [];
  for (const name of readdirSync(FIXTURES_DIR)) {
    if (SKIP_FIXTURE.test(name)) continue;
    const dir = join(FIXTURES_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const bodyPath = join(dir, "response.body");
    const metaPath = join(dir, "response.json");
    const requestPath = join(dir, "request.json");
    const body = readFileSync(bodyPath, "utf8");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      headers?: Record<string, string>;
    };
    const req = JSON.parse(readFileSync(requestPath, "utf8")) as {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    const contentType = meta.headers?.["content-type"];
    out.push({
      dir: name,
      body,
      contentType,
      requestBody: req.body ?? null,
      requestHeaders: req.headers,
      requestMethod: req.method ?? "GET",
    });
  }
  return out;
}

function isSSE(spec: FixtureSpec): boolean {
  if (spec.contentType?.includes("event-stream")) return true;
  return spec.body.startsWith("event:");
}

describe("fixture response schema validation", () => {
  const fixtures = loadFixtures();
  for (const spec of fixtures) {
    test(spec.dir, () => {
      if (isSSE(spec)) {
        const events = parseSSE(spec.body);
        for (const e of events) {
          // .parse throws on mismatch — Bun's test runner surfaces it
          // as a failure with the offending event in the stack.
          AnthropicSSEPayloadSchema.parse(e.data);
        }
      } else {
        const parsed = JSON.parse(spec.body) as { type?: string };
        if (parsed?.type === 'error') {
          AnthropicErrorResponseSchema.parse(parsed);
        } else {
          AnthropicMessageResponseSchema.parse(parsed);
        }
      }
    });
  }
});

// Each request.json holds what we POST to CCR /v1/messages — the
// Anthropic-shaped inbound body. Running it through the production
// AnthropicIncomingRequestSchema is the regression guard for tightening
// that schema: a removed .optional() that breaks a real-world client
// shape will fail here against the captured corpus.
describe("fixture request schema validation", () => {
  const fixtures = loadFixtures();
  for (const spec of fixtures) {
    if (spec.requestMethod !== "POST" || spec.requestBody === null) continue;
    test(spec.dir, () => {
      AnthropicIncomingRequestSchema.strict().parse(spec.requestBody);
    });
  }
});

// Validate request headers stored in each fixture's request.json against
// AnthropicIncomingRequestHeadersSchema. Fixtures that pre-date header
// capture (no `headers` field) are skipped — they will gain headers on
// the next capture run.
describe("fixture request header validation", () => {
  const fixtures = loadFixtures();
  for (const spec of fixtures) {
    if (spec.requestMethod !== "POST") continue;
    if (!spec.requestHeaders) continue;
    test(spec.dir, () => {
      AnthropicIncomingRequestHeadersSchema.strict().parse(spec.requestHeaders);
    });
  }
});
