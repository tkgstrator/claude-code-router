/**
 * Cross-provider scenario tests.
 *
 * Each scenario exercises a transformer concern that the basic
 * hello/pong/42 smokes don't reach. Bodies match what
 * `scripts/capture-fixtures.ts` recorded; the assertions check the
 * unified Anthropic SSE shape coming back out of Rialto.
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
  extractUsageFromEvents,
  assertAnthropicSSEShape,
  IS_REPLAY,
  TEST_TIMEOUT,
  type SSEEvent,
} from "./helpers";

// In replay mode any captured request body works without creds. In live
// mode we honour the same per-provider gates the smokes already use.
const liveOff = process.env.RIALTO_SKIP_LIVE_TESTS;
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

const THINKING_TARGETS = [
  { provider: "claude-code", model: "claude-opus-4-8", gate: hasClaudeOauth },
  { provider: "claude-code", model: "claude-opus-4-7", gate: hasClaudeOauth },
];

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

// ─── Prompt caching (Anthropic only) ────────────────────────────────────

// Long system prompt that exceeds Anthropic's 1024-token minimum for
// prompt caching. Must stay byte-for-byte identical to the constant in
// scripts/capture-fixtures.ts so the fixture hash matches at replay time.
const LONG_CACHE_SYSTEM = `You are an expert software engineer specializing in TypeScript and distributed systems. You follow strict coding guidelines and best practices.

## Core Principles

### Code Quality
- Write clean, readable, maintainable code that future developers can easily understand.
- Prefer explicit over implicit — named constants beat magic numbers, descriptive variables beat single letters.
- Keep functions small and focused. A function should do exactly one thing and do it well.
- Avoid premature optimization. Write correct code first, then optimize only proven bottlenecks.
- Prefer composition over inheritance. Favor small composable units over deep class hierarchies.

### TypeScript Best Practices
- Enable strict mode in tsconfig.json and never suppress errors with @ts-ignore or as unknown.
- Use discriminated unions to model sum types. Never use boolean flags to track mutually exclusive states.
- Prefer readonly for data that should not change after construction.
- Use const assertions for literal types when the value is known at compile time.
- Avoid enums; prefer union types or const objects with as const.
- Never use any — use unknown and narrow explicitly. Every boundary between systems is unknown until proven otherwise.
- Utility types (Partial, Required, Pick, Omit, Record, ReturnType, Parameters) are your friends — learn them.
- Write type predicates and assertion functions to push type narrowing to the call site.

### Error Handling
- Never swallow errors silently. Log or rethrow, never just catch and ignore.
- Distinguish recoverable errors (wrong input, rate limits) from unrecoverable ones (OOM, filesystem corruption).
- Use custom error classes with typed payloads for errors that consumers must handle.
- Propagate context up the stack. A low-level "ENOENT" is useless; "failed to read config at ~/.config/app.json: ENOENT" is actionable.
- In async code, always handle promise rejection — unhandled rejections crash Node.js in production.

### Testing
- Write tests for observable behavior, not implementation details. Tests that break on refactors without functional changes are a liability.
- Unit tests cover pure functions and isolated modules. Integration tests cover module boundaries. E2E tests cover user workflows.
- Test the unhappy paths with the same rigor as the happy paths. The edge cases are where bugs live.
- Use table-driven tests (parameterized) for logic that varies by input. A loop over a cases array is cleaner than dozens of near-identical test bodies.
- Aim for tests that are deterministic and environment-independent. Avoid time-dependent assertions; mock the clock.

### API Design
- Follow REST semantics faithfully: GET is idempotent and cacheable, POST is not, PUT/PATCH/DELETE have specific contracts.
- Version your APIs from day one. Breaking changes in unversioned APIs cost you users.
- Return consistent error envelopes. Clients should not have to guess whether an error is in body.error, body.message, or body.errors[0].
- Paginate all list endpoints. Returning unbounded arrays is a DoS vector and a performance time bomb.
- Use ISO 8601 for all timestamps. Unix seconds and milliseconds in the same codebase is a bug waiting to happen.

### Database
- Never run unbounded queries. Always include LIMIT in user-facing queries.
- Use database transactions for operations that must be atomic. Partial writes are worse than no writes.
- Index columns that appear in WHERE, ORDER BY, and JOIN predicates. Unindexed full-table scans degrade as data grows.
- Avoid N+1 queries. Use JOIN or batch loading to fetch related records in one round trip.
- Write migrations as forward-only, idempotent scripts. Rollback migrations are rarely run and often broken; build forward instead.

### Security
- Never log secrets, API keys, or PII. Treat logs as potentially public.
- Validate and sanitize all user input at the system boundary. Never trust data from the network.
- Use parameterized queries. String interpolation in SQL is a SQL injection waiting to happen.
- Apply the principle of least privilege. Services should request only the permissions they need.
- Rotate secrets on a schedule and on suspected compromise. Hard-coded secrets are a security incident in waiting.

### Performance
- Measure before optimizing. Profile to find the actual bottleneck; do not guess.
- Prefer lazy evaluation for expensive operations. Compute only what is needed, when it is needed.
- Use connection pooling for database and HTTP clients. Opening a new connection per request is expensive.
- Cache at the appropriate layer: in-process for hot data, distributed cache for shared state, CDN for static assets.
- Compression reduces bandwidth cost. Enable gzip/brotli on HTTP responses for text payloads.

Reply to the user's question clearly and concisely, following these guidelines in all code you write.`;

function cacheWriteBody(provider: string, model: string) {
  return {
    model: `${provider},${model}`,
    max_tokens: 64,
    system: [{ type: "text", text: LONG_CACHE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user" as const, content: "Reply with the word 'pong' only." }],
  };
}

function cacheReadBody(provider: string, model: string) {
  return {
    model: `${provider},${model}`,
    max_tokens: 64,
    system: [{ type: "text", text: LONG_CACHE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user" as const, content: "Reply with the word 'pong' only." },
      { role: "assistant" as const, content: "pong" },
      { role: "user" as const, content: "Reply with the word 'pong' one more time." },
    ],
  };
}

const CACHE_TARGETS = [{ provider: "claude-code", model: "claude-haiku-4-5", gate: hasClaudeOauth }];

describe("prompt caching", () => {
  for (const { provider, model, gate } of CACHE_TARGETS) {
    describe.skipIf(!gate)(`${provider}/${model}`, () => {
      test(
        "first request writes the cache (cache_creation_input_tokens > 0)",
        async () => {
          const events = await streamMessage(cacheWriteBody(provider, model));
          assertAnthropicSSEShape(events);
          const usage = extractUsageFromEvents(events);
          expect(usage).not.toBeNull();
          expect(usage!.cache_creation_input_tokens).toBeGreaterThan(0);
          expect(usage!.cache_read_input_tokens).toBe(0);
        },
        TEST_TIMEOUT
      );

      test(
        "second request reads from the cache (cache_read_input_tokens > 0)",
        async () => {
          const events = await streamMessage(cacheReadBody(provider, model));
          assertAnthropicSSEShape(events);
          const usage = extractUsageFromEvents(events);
          expect(usage).not.toBeNull();
          expect(usage!.cache_read_input_tokens).toBeGreaterThan(0);
          expect(usage!.cache_creation_input_tokens).toBe(0);
          const text = extractTextFromEvents(events);
          expect(text.toLowerCase()).toContain("pong");
        },
        TEST_TIMEOUT
      );
    });
  }
});

// ─── Redacted thinking in multi-turn history (Anthropic only) ────────────

function redactedThinkingBody(provider: string, model: string) {
  return {
    model: `${provider},${model}`,
    max_tokens: 2048,
    thinking: { type: "enabled" as const, budget_tokens: 1024 },
    messages: [
      { role: "user" as const, content: "What is 23 * 47? Think it through step by step." },
      {
        role: "assistant" as const,
        content: [
          {
            type: "thinking",
            thinking: "",
            signature:
              "EqoBCkgIARAAGgpjbGF1ZGUtYWkqIGFudGhyb3BpYy1oYXNoZWQtY29udGVudC1zaWduYXR1cmUyIMO2rE9IHhcMzEzOGJmZjIxNjk0NzM0ZGZhZTgyMGM4",
          },
          { type: "text", text: "23 × 47 = 1081" },
        ],
      },
      { role: "user" as const, content: "What is 100 * 100? Reply with just the number." },
    ],
  };
}

const REDACTED_THINKING_TARGETS = [
  { provider: "claude-code", model: "claude-opus-4-8", gate: hasClaudeOauth },
  { provider: "claude-code", model: "claude-opus-4-7", gate: hasClaudeOauth },
];

describe("redacted thinking in history", () => {
  for (const { provider, model, gate } of REDACTED_THINKING_TARGETS) {
    describe.skipIf(!gate)(`${provider}/${model}`, () => {
      test(
        "multi-turn with empty thinking block does not error and returns correct answer",
        async () => {
          const events = await streamMessage(redactedThinkingBody(provider, model));
          assertAnthropicSSEShape(events);
          const text = extractTextFromEvents(events);
          expect(text).toContain("10000");
        },
        TEST_TIMEOUT
      );
    });
  }
});
