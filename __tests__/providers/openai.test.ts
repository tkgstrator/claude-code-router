/**
 * Integration tests for the openai provider.
 * Requires OPENAI_API_KEY environment variable to be set.
 * CCR must be running at http://127.0.0.1:3456.
 */

import { describe, test, expect } from "bun:test";
import {
  streamMessage,
  sendMessage,
  extractTextFromEvents,
  assertAnthropicSSEShape,
  TEST_TIMEOUT,
} from "./helpers";

const hasApiKey = Boolean(process.env.OPENAI_API_KEY);

describe.skipIf(!hasApiKey)("openai / gpt-4o-mini", () => {
  test(
    "streaming response has correct Anthropic SSE shape",
    async () => {
      const events = await streamMessage({
        model: "openai,gpt-4o-mini",
        max_tokens: 100,
        messages: [{ role: "user", content: "Say exactly: hello" }],
      });

      assertAnthropicSSEShape(events);
      const text = extractTextFromEvents(events);
      expect(text.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );

  test(
    "response contains expected text",
    async () => {
      const events = await streamMessage({
        model: "openai,gpt-4o-mini",
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
      });

      const text = extractTextFromEvents(events);
      expect(text.toLowerCase()).toContain("pong");
    },
    TEST_TIMEOUT
  );

  test(
    "non-streaming response returns Anthropic message format",
    async () => {
      const res = await sendMessage({
        model: "openai,gpt-4o-mini",
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with only the number 42." }],
        stream: false,
      });

      expect(res.ok).toBe(true);
      const body = await res.json() as any;
      expect(body.type).toBe("message");
      expect(body.role).toBe("assistant");
      expect(Array.isArray(body.content)).toBe(true);
      const text = body.content.map((c: any) => c.text ?? "").join("");
      expect(text).toContain("42");
    },
    TEST_TIMEOUT
  );
});

describe.skipIf(!hasApiKey)("openai / gpt-4o", () => {
  test(
    "streaming response has correct Anthropic SSE shape",
    async () => {
      const events = await streamMessage({
        model: "openai,gpt-4o",
        max_tokens: 100,
        messages: [{ role: "user", content: "Say exactly: hello" }],
      });

      assertAnthropicSSEShape(events);
      const text = extractTextFromEvents(events);
      expect(text.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );
});
