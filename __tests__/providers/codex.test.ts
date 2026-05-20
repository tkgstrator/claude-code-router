/**
 * Integration tests for the codex subscription provider
 * (ChatGPT Plus via Codex CLI credentials).
 *
 * Requires ~/.codex/auth.json with valid tokens and the CCR server
 * running (default http://127.0.0.1:16173, override with CCR_TEST_URL).
 *
 * Every enabled codex subscription model from /api/config is smoke
 * tested through /v1 (codex routes via the openai-responses +
 * codex-oauth chain to the ChatGPT backend). Any non-200 — incl.
 * a 429 — is a hard failure, same policy as the claude-code matrix.
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
const hasCredentials =
  existsSync(AUTH_PATH) && !process.env.CCR_SKIP_LIVE_TESTS;

const result = await (async (): Promise<
  { models: SubscriptionModel[] } | { error: string }
> => {
  if (!hasCredentials) return { models: [] };
  try {
    return { models: await fetchSubscriptionModels(/codex/i) };
  } catch (e) {
    return { error: (e as Error).message };
  }
})();

describe.skipIf(!hasCredentials)("codex subscription / all enabled models", () => {
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
          const text = await smokeSubscriptionModel(`${provider},${model}`);
          expect(text.length).toBeGreaterThan(0);
        },
        TEST_TIMEOUT
      );
    });
  }
});
