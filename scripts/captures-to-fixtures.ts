#!/usr/bin/env bun
/**
 * Convert mitmproxy captures (./captures/) into CCR test fixtures
 * (__tests__/providers/__fixtures__/).
 *
 * Captures are raw api.anthropic.com traffic captured from Claude Code.
 * CCR fixtures represent Claude Code → CCR, so each capture is transformed:
 *   - URL:   https://api.anthropic.com/v1/messages?* → http://127.0.0.1:16173/v1/messages
 *   - model: "claude-haiku-4-5-20251001" → "claude-code,claude-haiku-4-5"
 *
 * Scenario is inferred from response tokens and request shape:
 *   thinking      — thinking block in request
 *   cache-read    — cache_read_input_tokens > 0 in response
 *   cache-write   — cache_creation_input_tokens > 0, read == 0
 *   multi-turn    — messages.length > 1
 *   smoke         — everything else
 *
 * Usage:
 *   bun run scripts/captures-to-fixtures.ts           # skip existing
 *   FORCE=1 bun run scripts/captures-to-fixtures.ts   # overwrite all
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CCR_BASE = process.env.CCR_TEST_URL ?? "http://127.0.0.1:16173";
const CAPTURES_DIR = join(import.meta.dir, "..", "captures");
const FIXTURES_DIR = join(import.meta.dir, "..", "__tests__", "providers", "__fixtures__");
const FORCE = Boolean(process.env.FORCE);

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function hashKey(method: string, url: string, body: unknown): string {
  const canon = JSON.stringify({ method, url, body: body ?? null });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

function sanitizeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Strip date suffix: "claude-haiku-4-5-20251001" → "claude-haiku-4-5" */
function stripModelDate(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/** "claude-haiku-4-5-20251001" → "claude-code,claude-haiku-4-5" */
function toCcrModel(anthropicModel: string): string {
  return `claude-code,${stripModelDate(anthropicModel)}`;
}

/** Infer a scenario label from request body and response body text. */
function inferScenario(body: Record<string, unknown>, responseText: string): string {
  const hasThinking =
    typeof body.thinking === "object" && body.thinking !== null;
  const cacheRead = (() => {
    const m = responseText.match(/"cache_read_input_tokens":(\d+)/);
    return m ? Number(m[1]) : 0;
  })();
  const cacheWrite = (() => {
    const m = responseText.match(/"cache_creation_input_tokens":(\d+)/);
    return m ? Number(m[1]) : 0;
  })();
  const msgCount = Array.isArray(body.messages) ? (body.messages as unknown[]).length : 0;

  if (hasThinking && cacheRead > 0) return "thinking-cache-read";
  if (hasThinking) return "thinking";
  if (cacheRead > 0 && msgCount > 1) return "cache-read-multi-turn";
  if (cacheRead > 0) return "cache-read";
  if (cacheWrite > 0) return "cache-write";
  if (msgCount > 1) return "multi-turn";
  return "smoke";
}

// -------------------------------------------------------------------------
// List captures that are from api.anthropic.com /v1/messages
// -------------------------------------------------------------------------

function listCaptureDirs(): string[] {
  if (!existsSync(CAPTURES_DIR)) return [];
  return readdirSync(CAPTURES_DIR).filter((name) => {
    try {
      return statSync(join(CAPTURES_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

interface Capture {
  dir: string;
  requestJson: {
    label: string;
    method: string;
    url: string;
    headers?: Record<string, string>;
    body: Record<string, unknown> | null;
  };
  responseJson: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
  };
  responseBody: string;
}

function loadCapture(dir: string): Capture | null {
  const base = join(CAPTURES_DIR, dir);
  const reqPath = join(base, "request.json");
  const respPath = join(base, "response.json");
  const bodyPath = join(base, "response.body");
  if (!existsSync(reqPath) || !existsSync(respPath) || !existsSync(bodyPath)) return null;
  try {
    return {
      dir,
      requestJson: JSON.parse(readFileSync(reqPath, "utf8")),
      responseJson: JSON.parse(readFileSync(respPath, "utf8")),
      responseBody: readFileSync(bodyPath, "utf8"),
    };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------
// Convert one capture → fixture
// -------------------------------------------------------------------------

const CCR_MESSAGES_URL = `${CCR_BASE}/v1/messages`;

// Headers forwarded from Anthropic that make sense to keep in fixtures.
const KEEP_HEADERS = new Set([
  "content-type",
  "cache-control",
  "request-id",
  "anthropic-organization-id",
  "x-cloud-trace-context",
]);

// Per-scenario counters for deduplication when the same scenario appears
// multiple times for the same model.
const scenarioCount: Record<string, number> = {};

function convertCapture(capture: Capture): "recorded" | "skipped" | "failed" | "ignored" {
  const { requestJson, responseJson, responseBody } = capture;

  // Only handle POST /v1/messages from api.anthropic.com
  if (requestJson.method !== "POST") return "ignored";
  if (!requestJson.url.includes("api.anthropic.com/v1/messages")) return "ignored";
  if (!requestJson.body) return "ignored";

  const origBody = requestJson.body;
  const origModel = typeof origBody.model === "string" ? origBody.model : null;
  if (!origModel) return "ignored";

  // Build transformed request body (model rewritten to CCR selector).
  const newBody: Record<string, unknown> = { ...origBody, model: toCcrModel(origModel) };

  const method = requestJson.method;
  const url = CCR_MESSAGES_URL;
  const hash = hashKey(method, url, newBody);

  const shortModel = stripModelDate(origModel); // e.g. claude-haiku-4-5
  const scenario = inferScenario(origBody, responseBody);
  const countKey = `${shortModel}/${scenario}`;
  scenarioCount[countKey] = (scenarioCount[countKey] ?? 0) + 1;
  const suffix = scenarioCount[countKey] > 1 ? `-${scenarioCount[countKey]}` : "";

  const slug = sanitizeSlug(`claude-code-${shortModel}-${scenario}${suffix}`);
  const label = `claude-code/${shortModel}: ${scenario}${suffix}`;

  const outDir = join(FIXTURES_DIR, `${slug}.${hash}`);
  const reqOut = join(outDir, "request.json");
  const respOut = join(outDir, "response.json");
  const bodyOut = join(outDir, "response.body");

  if (existsSync(reqOut) && existsSync(respOut) && existsSync(bodyOut) && !FORCE) {
    console.log(`skip  ${label}`);
    return "skipped";
  }

  try {
    // Filter response headers to keep only the meaningful subset.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(responseJson.headers)) {
      if (KEEP_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
    }
    headers["content-type"] = headers["content-type"] ?? "text/event-stream";

    // Build request headers for the fixture: use captured headers when available,
    // rewriting auth to the CCR test key. Fall back to a minimal synthetic set.
    let reqHeaders: Record<string, string> | undefined;
    if (requestJson.headers && Object.keys(requestJson.headers).length > 0) {
      reqHeaders = {};
      for (const [k, v] of Object.entries(requestJson.headers)) {
        const lk = k.toLowerCase();
        if (lk === "x-api-key" || lk === "authorization") {
          reqHeaders[lk] = "test";
        } else {
          reqHeaders[lk] = v;
        }
      }
    } else {
      // Synthetic fallback — mirrors what capture-fixtures.ts sends to CCR.
      reqHeaders = {
        "content-type": "application/json",
        "x-api-key": "test",
        "anthropic-version": "2023-06-01",
      };
    }

    mkdirSync(outDir, { recursive: true });

    writeFileSync(
      reqOut,
      JSON.stringify({ label, method, url, headers: reqHeaders, body: newBody }, null, 2) + "\n"
    );
    writeFileSync(
      respOut,
      JSON.stringify(
        { status: responseJson.status, statusText: responseJson.statusText, headers },
        null,
        2
      ) + "\n"
    );
    writeFileSync(bodyOut, responseBody);

    console.log(`ok    ${label}  →  ${slug}.${hash}/  (${responseBody.length} B)`);
    return "recorded";
  } catch (e) {
    console.error(`FAIL  ${label}: ${(e as Error).message}`);
    return "failed";
  }
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

mkdirSync(FIXTURES_DIR, { recursive: true });

const dirs = listCaptureDirs();
const counts = { recorded: 0, skipped: 0, failed: 0, ignored: 0 };

for (const dir of dirs) {
  const capture = loadCapture(dir);
  if (!capture) continue;
  const result = convertCapture(capture);
  counts[result]++;
}

console.log(
  `\nDone: ${counts.recorded} recorded, ${counts.skipped} skipped,` +
    ` ${counts.failed} failed, ${counts.ignored} ignored`
);
if (counts.failed > 0) process.exit(1);
