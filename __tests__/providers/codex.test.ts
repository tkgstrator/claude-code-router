/**
 * Integration tests for the codex subscription provider
 * (ChatGPT Plus via Codex CLI credentials).
 *
 * Requires ~/.codex/auth.json with valid tokens and the CCR server
 * running (default http://127.0.0.1:16173, override with CCR_TEST_URL).
 *
 * NOTE: codex subscription routing through /v1 is not wired yet — it
 * needs a dedicated `codex-credentials` transformer in src/llms plus a
 * CREDENTIALS_TRANSFORMER entry in src/llmsContext.ts (only claude-code
 * is mapped today). Until that lands these would fail at the proxy, so
 * the suite skips by default. Set CCR_CODEX_V1_READY=1 once the
 * transformer exists; the enumeration then covers every enabled codex
 * model automatically, no edits needed.
 */

import { describe, test, expect } from "bun:test";
import {
  smokeSubscriptionModel,
  fetchSubscriptionModels,
  TEST_TIMEOUT,
  type SubscriptionModel,
} from "./helpers";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const AUTH_PATH = join(homedir(), ".codex", "auth.json");
const codexV1Ready = process.env.CCR_CODEX_V1_READY === "1";
const hasCredentials =
  existsSync(AUTH_PATH) && !process.env.CCR_SKIP_LIVE_TESTS;
const enabled = hasCredentials && codexV1Ready;

if (hasCredentials && !codexV1Ready) {
  console.warn(
    "Skipping codex /v1 tests: codex-credentials transformer not wired yet. " +
      "Set CCR_CODEX_V1_READY=1 after implementing it to enable the matrix."
  );
}

const result = await (async (): Promise<
  { models: SubscriptionModel[] } | { error: string }
> => {
  if (!enabled) return { models: [] };
  try {
    return { models: await fetchSubscriptionModels(/codex/i) };
  } catch (e) {
    return { error: (e as Error).message };
  }
})();

describe.skipIf(!enabled)("codex subscription / all enabled models", () => {
  if ("error" in result) {
    test("CCR server reachable for /api/config", () => {
      throw new Error(
        `Could not load model matrix from CCR — is the server running? ${result.error}`
      );
    });
    return;
  }

  if (result.models.length === 0) {
    test("at least one enabled codex subscription model", () => {
      throw new Error(
        "No enabled codex subscription models in /api/config — nothing to verify"
      );
    });
    return;
  }

  for (const { provider, model } of result.models) {
    describe(`${provider},${model}`, () => {
      test(
        "HTTP 200 + valid Anthropic SSE with text",
        async () => {
          const outcome = await smokeSubscriptionModel(`${provider},${model}`);
          if (outcome.kind === "skipped-quota") {
            console.warn(`${provider},${model} sustained quota limit, skipping assertion: ${outcome.message}`);
            return;
          }
          expect(outcome.text.length).toBeGreaterThan(0);
        },
        TEST_TIMEOUT
      );
    });
  }
});
