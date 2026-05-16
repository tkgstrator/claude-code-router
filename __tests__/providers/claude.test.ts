/**
 * Integration tests for the claude-code subscription provider
 * (Anthropic via Claude Code OAuth credentials).
 *
 * Requires ~/.claude/.credentials.json to be present and the CCR server
 * running (default http://127.0.0.1:16173, override with CCR_TEST_URL).
 *
 * Every *enabled* model of every claude-* subscription provider in
 * /api/config is smoke-tested, so the matrix tracks the DB instead of a
 * hardcoded list. A long-context 429 ("Extra usage is required for long
 * context requests") is a HARD failure — that's the regression guard
 * for the context-1m beta strip (subscription routing). A generic quota
 * 429 is tolerated as a skip, since the claude-code free tier genuinely
 * rate-limits and that is not our bug.
 */

import { describe, test, expect } from "bun:test";
import {
  streamMessage,
  extractTextFromEvents,
  assertAnthropicSSEShape,
  fetchSubscriptionModels,
  TEST_TIMEOUT,
  type SubscriptionModel,
} from "./helpers";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const hasCredentials =
  existsSync(CREDENTIALS_PATH) && !process.env.CCR_SKIP_LIVE_TESTS;

const isLongContextGate = (msg: string): boolean =>
  /extra usage is required for long context|long context request/i.test(msg);
const isGenericRateLimit = (msg: string): boolean =>
  /\b429\b|rate_limit|rate limit/i.test(msg);

const result = await (async (): Promise<
  { models: SubscriptionModel[] } | { error: string }
> => {
  if (!hasCredentials) return { models: [] };
  try {
    return { models: await fetchSubscriptionModels(/claude/i) };
  } catch (e) {
    return { error: (e as Error).message };
  }
})();

describe.skipIf(!hasCredentials)("claude-code subscription / all enabled models", () => {
  if ("error" in result) {
    test("CCR server reachable for /api/config", () => {
      throw new Error(
        `Could not load model matrix from CCR — is the server running? ${result.error}`
      );
    });
    return;
  }

  if (result.models.length === 0) {
    test("at least one enabled claude-code subscription model", () => {
      throw new Error(
        "No enabled claude-* subscription models in /api/config — nothing to verify"
      );
    });
    return;
  }

  for (const { provider, model } of result.models) {
    describe(`${provider},${model}`, () => {
      test(
        "streaming returns valid Anthropic SSE with text",
        async () => {
          let events: Awaited<ReturnType<typeof streamMessage>>;
          try {
            events = await streamMessage({
              model: `${provider},${model}`,
              max_tokens: 64,
              messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
            });
          } catch (err) {
            const msg = (err as Error).message ?? "";
            // Regression guard: the context-1m beta strip must keep
            // subscription routing off Anthropic's long-context billing
            // gate. If this 429 ever comes back, fail loudly.
            if (isLongContextGate(msg)) {
              throw new Error(
                `${provider},${model}: long-context 429 regressed — context-1m beta is reaching Anthropic again. ${msg}`
              );
            }
            // Genuine transient quota limit on the free tier — not our
            // bug; skip rather than flake the suite.
            if (isGenericRateLimit(msg)) {
              console.warn(`${provider},${model} rate limited (quota), skipping assertion: ${msg}`);
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
  }
});
