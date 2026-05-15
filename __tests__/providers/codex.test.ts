/**
 * Integration tests for the codex provider (ChatGPT Plus via Codex CLI credentials).
 * Requires ~/.codex/auth.json to be present with valid tokens.
 * CCR must be running at http://127.0.0.1:3456.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  streamMessage,
  extractTextFromEvents,
  assertAnthropicSSEShape,
  TEST_TIMEOUT,
} from "./helpers";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const AUTH_PATH = join(homedir(), ".codex", "auth.json");
const hasCredentials =
  existsSync(AUTH_PATH) && !process.env.CCR_SKIP_LIVE_TESTS;

describe.skipIf(!hasCredentials)("codex / gpt-5.5", () => {
  beforeAll(() => {
    if (!hasCredentials) {
      console.warn(`Skipping codex tests: ${AUTH_PATH} not found. Run 'codex' to authenticate.`);
    }
  });

  test(
    "streaming response has correct Anthropic SSE shape",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.5",
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
    "response contains text content",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.5",
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
      });

      const text = extractTextFromEvents(events);
      expect(text.toLowerCase()).toContain("pong");
    },
    TEST_TIMEOUT
  );

  test(
    "message_start event contains model info",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.5",
        max_tokens: 50,
        messages: [{ role: "user", content: "Hi" }],
      });

      const startEvent = events.find((e) => e.event === "message_start");
      expect(startEvent).toBeDefined();
      const message = (startEvent?.data as any)?.message;
      expect(message).toBeDefined();
      expect(message?.role).toBe("assistant");
    },
    TEST_TIMEOUT
  );
});

describe.skipIf(!hasCredentials)("codex / gpt-5.4", () => {
  test(
    "streaming response has correct Anthropic SSE shape",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.4",
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
    "response contains text content",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.4",
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
      });

      const text = extractTextFromEvents(events);
      expect(text.toLowerCase()).toContain("pong");
    },
    TEST_TIMEOUT
  );

  test(
    "message_start event contains model info",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.4",
        max_tokens: 50,
        messages: [{ role: "user", content: "Hi" }],
      });

      const startEvent = events.find((e) => e.event === "message_start");
      expect(startEvent).toBeDefined();
      const message = (startEvent?.data as any)?.message;
      expect(message).toBeDefined();
      expect(message?.role).toBe("assistant");
    },
    TEST_TIMEOUT
  );
});

describe.skipIf(!hasCredentials)("codex / gpt-5.3-codex", () => {
  test(
    "streaming response has correct Anthropic SSE shape",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.3-codex",
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
    "response contains text content",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.3-codex",
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
      });

      const text = extractTextFromEvents(events);
      expect(text.toLowerCase()).toContain("pong");
    },
    TEST_TIMEOUT
  );

  test(
    "message_start event contains model info",
    async () => {
      const events = await streamMessage({
        model: "codex,gpt-5.3-codex",
        max_tokens: 50,
        messages: [{ role: "user", content: "Hi" }],
      });

      const startEvent = events.find((e) => e.event === "message_start");
      expect(startEvent).toBeDefined();
      const message = (startEvent?.data as any)?.message;
      expect(message).toBeDefined();
      expect(message?.role).toBe("assistant");
    },
    TEST_TIMEOUT
  );
});
