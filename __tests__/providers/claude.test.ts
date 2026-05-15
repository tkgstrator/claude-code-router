/**
 * Integration tests for the claude provider (Anthropic via Claude Code OAuth credentials).
 * Requires ~/.claude/.credentials.json to be present.
 * CCR must be running at http://127.0.0.1:3456.
 */

import { describe, test, expect } from "bun:test";
import {
  streamMessage,
  sendMessage,
  extractTextFromEvents,
  assertAnthropicSSEShape,
  TEST_TIMEOUT,
  type SSEEvent,
} from "./helpers";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const hasCredentials = existsSync(CREDENTIALS_PATH);

describe.skipIf(!hasCredentials)("claude / claude-haiku-4-5 (claude-code-credentials)", () => {
  test(
    "streaming response has correct Anthropic SSE shape",
    async () => {
      const events = await streamMessage({
        model: "claude,claude-haiku-4-5-20251001",
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
        model: "claude,claude-haiku-4-5-20251001",
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
        model: "claude,claude-haiku-4-5-20251001",
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

  test(
    "system prompt is respected",
    async () => {
      const events = await streamMessage({
        model: "claude,claude-haiku-4-5-20251001",
        max_tokens: 100,
        system: "You are a pirate. Every sentence must end with the word ARRR.",
        messages: [{ role: "user", content: "Say hello." }],
      });

      const text = extractTextFromEvents(events);
      expect(text.toUpperCase()).toContain("ARRR");
    },
    TEST_TIMEOUT
  );
});

describe.skipIf(!hasCredentials)("claude / claude-sonnet-4-6 (claude-code-credentials)", () => {
  test(
    "streaming response has correct Anthropic SSE shape",
    async () => {
      let events: SSEEvent[];
      try {
        events = await streamMessage({
          model: "claude,claude-sonnet-4-6",
          max_tokens: 100,
          messages: [{ role: "user", content: "Say exactly: hello" }],
        });
      } catch (err: any) {
        // claude-code-credentials free tier may hit rate limits; treat as skipped
        if (err.message?.includes("429") || err.message?.includes("rate_limit")) {
          console.warn("claude-sonnet-4-6 rate limited, skipping assertion");
          return;
        }
        throw err;
      }
      assertAnthropicSSEShape(events);
      const text = extractTextFromEvents(events);
      expect(text.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );
});
