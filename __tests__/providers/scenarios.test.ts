/**
 * Cross-provider scenario tests.
 *
 * Each scenario exercises a transformer concern that the basic
 * hello/pong/42 smokes don't reach. Bodies match what
 * `scripts/capture-fixtures.ts` recorded; the assertions check the
 * unified Anthropic SSE shape coming back out of CCR.
 *
 *   tool-use     model uses a function call instead of plain text
 *   system       system prompt steers the reply
 *   multi-turn   prior assistant turn is fed back in
 *   thinking     anthropic extended-thinking request shape
 */

import { describe, test, expect } from "bun:test";
import {
  streamMessage,
  extractTextFromEvents,
  assertAnthropicSSEShape,
  IS_REPLAY,
  TEST_TIMEOUT,
  type SSEEvent,
} from "./helpers";

// In replay mode any captured request body works without creds. In live
// mode we honour the same per-provider gates the smokes already use.
const liveOff = process.env.CCR_SKIP_LIVE_TESTS;
const hasOpenAI = IS_REPLAY || (Boolean(process.env.OPENAI_API_KEY) && !liveOff);
const hasGemini = IS_REPLAY || (Boolean(process.env.GEMINI_API_KEY) && !liveOff);
const hasClaudeOauth = IS_REPLAY || !liveOff; // creds detection is per-suite; keep loose here
const hasCodexOauth = IS_REPLAY || !liveOff;

// ─── Per-scenario body builders ─────────────────────────────────────────

function toolUseBody(provider: string, model: string) {
  return {
    model: `${provider},${model}`,
    max_tokens: 256,
    messages: [
      {
        role: "user" as const,
        content:
          "What is the weather in Tokyo right now? You must call the get_weather tool — do not answer in text.",
      },
    ],
    tools: [
      {
        name: "get_weather",
        description: "Get the current weather for a city.",
        input_schema: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name, e.g. Tokyo" },
          },
          required: ["location"],
        },
      },
    ],
  };
}

function systemBody(provider: string, model: string) {
  return {
    model: `${provider},${model}`,
    max_tokens: 50,
    system: "You ONLY ever reply with the single word: pizza. No punctuation, no other text.",
    messages: [{ role: "user" as const, content: "What is your favorite food?" }],
  };
}

function multiTurnBody(provider: string, model: string) {
  return {
    model: `${provider},${model}`,
    max_tokens: 50,
    messages: [
      { role: "user" as const, content: "My favorite number is 17. Please remember it." },
      { role: "assistant" as const, content: "Got it — your favorite number is 17." },
      { role: "user" as const, content: "What is my favorite number? Reply with only the number." },
    ],
  };
}

function thinkingBody(provider: string, model: string) {
  return {
    model: `${provider},${model}`,
    max_tokens: 2048,
    thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [
      {
        role: "user" as const,
        content: "What is 23 * 47? Think it through step by step, then give the final number only.",
      },
    ],
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

// True when at least one content_block_start carries a tool_use payload.
function hasToolUseBlock(events: SSEEvent[]): boolean {
  return events.some((e) => {
    if (e.event !== "content_block_start") return false;
    const block = (e.data as { content_block?: { type?: string } }).content_block;
    return block?.type === "tool_use";
  });
}

// Pull the concatenated input_json_delta partials for a streamed tool call.
function extractToolInputJson(events: SSEEvent[]): string {
  return events
    .filter((e) => e.event === "content_block_delta")
    .map((e) => {
      const delta = (e.data as { delta?: { type?: string; partial_json?: string } }).delta;
      return delta?.type === "input_json_delta" && typeof delta.partial_json === "string"
        ? delta.partial_json
        : "";
    })
    .join("");
}

// ─── Tool-use ───────────────────────────────────────────────────────────

const TOOL_USE_TARGETS = [
  { provider: "openai", model: "gpt-4.1-mini", gate: hasOpenAI },
  { provider: "google", model: "gemini-2.5-flash", gate: hasGemini },
  { provider: "claude-code", model: "claude-haiku-4-5", gate: hasClaudeOauth },
  { provider: "codex", model: "gpt-5.5", gate: hasCodexOauth },
];

describe("tool-use", () => {
  for (const { provider, model, gate } of TOOL_USE_TARGETS) {
    describe.skipIf(!gate)(`${provider}/${model}`, () => {
      test(
        "response includes a tool_use content block",
        async () => {
          const events = await streamMessage(toolUseBody(provider, model));
          assertAnthropicSSEShape(events);
          expect(hasToolUseBlock(events)).toBe(true);
          const tooljson = extractToolInputJson(events);
          // Don't assert the exact city — the model could pick a different
          // shape — just check the streamed input is non-empty JSON.
          expect(tooljson.length).toBeGreaterThan(0);
        },
        TEST_TIMEOUT
      );
    });
  }
});

// ─── System prompt ──────────────────────────────────────────────────────

const SYSTEM_TARGETS = [
  { provider: "openai", model: "gpt-4.1-mini", gate: hasOpenAI },
  { provider: "google", model: "gemini-2.5-flash", gate: hasGemini },
  { provider: "claude-code", model: "claude-haiku-4-5", gate: hasClaudeOauth },
];

describe("system prompt", () => {
  for (const { provider, model, gate } of SYSTEM_TARGETS) {
    describe.skipIf(!gate)(`${provider}/${model}`, () => {
      test(
        "system instruction steers the reply (says 'pizza')",
        async () => {
          const events = await streamMessage(systemBody(provider, model));
          assertAnthropicSSEShape(events);
          const text = extractTextFromEvents(events).toLowerCase();
          expect(text).toContain("pizza");
        },
        TEST_TIMEOUT
      );
    });
  }
});

// ─── Multi-turn ─────────────────────────────────────────────────────────

const MULTI_TURN_TARGETS = [
  { provider: "openai", model: "gpt-4.1-mini", gate: hasOpenAI },
  { provider: "google", model: "gemini-2.5-flash", gate: hasGemini },
  { provider: "claude-code", model: "claude-haiku-4-5", gate: hasClaudeOauth },
];

describe("multi-turn", () => {
  for (const { provider, model, gate } of MULTI_TURN_TARGETS) {
    describe.skipIf(!gate)(`${provider}/${model}`, () => {
      test(
        "model recalls a fact from a prior user turn",
        async () => {
          const events = await streamMessage(multiTurnBody(provider, model));
          assertAnthropicSSEShape(events);
          const text = extractTextFromEvents(events);
          expect(text).toContain("17");
        },
        TEST_TIMEOUT
      );
    });
  }
});

// ─── Extended thinking (Anthropic only) ─────────────────────────────────

const THINKING_TARGETS = [{ provider: "claude-code", model: "claude-opus-4-7", gate: hasClaudeOauth }];

describe("extended thinking", () => {
  for (const { provider, model, gate } of THINKING_TARGETS) {
    describe.skipIf(!gate)(`${provider}/${model}`, () => {
      test(
        "thinking request returns a valid SSE with the correct answer",
        async () => {
          const events = await streamMessage(thinkingBody(provider, model));
          assertAnthropicSSEShape(events);
          // The subscription path may or may not surface thinking_delta
          // events depending on backend tier — assert the model still
          // arrived at the correct answer regardless.
          const text = extractTextFromEvents(events);
          expect(text).toContain("1081");
        },
        TEST_TIMEOUT
      );
    });
  }
});
