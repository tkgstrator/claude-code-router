#!/usr/bin/env bun
/**
 * Capture live CCR responses for the provider integration tests into
 * __tests__/providers/__fixtures__/ so the suite can replay them
 * offline without paying upstream LLM costs.
 *
 *   bun run scripts/capture-fixtures.ts            # capture all (skips files that exist)
 *   FORCE=1 bun run scripts/capture-fixtures.ts    # overwrite existing fixtures
 *   bun run scripts/capture-fixtures.ts -- openai  # only specs whose slug starts with "openai"
 *
 * Requires a running CCR server. Override the defaults with:
 *   CCR_TEST_URL=http://127.0.0.1:16173
 *   CCR_TEST_APIKEY=<api key>
 *
 * Fixture format (deterministic hash of method+url+body):
 *   __tests__/providers/__fixtures__/<slug>.<hash8>.json
 *   {
 *     "label":   "openai/gpt-4.1-mini: stream hello",
 *     "request": { "method": "POST", "url": "...", "body": {...} },
 *     "response":{ "status": 200, "statusText": "OK",
 *                  "headers": { ... }, "body": "<raw text or SSE>" }
 *   }
 *
 * The hash is the lookup key cachedFetch() will use at replay time;
 * the slug is purely for humans browsing the directory.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CCR_BASE = process.env.CCR_TEST_URL ?? "http://127.0.0.1:16173";
const CCR_APIKEY = process.env.CCR_TEST_APIKEY ?? "test";
const FIXTURES_DIR = join(
  import.meta.dir,
  "..",
  "__tests__",
  "providers",
  "__fixtures__"
);
const FORCE = Boolean(process.env.FORCE);
const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"))[0];

interface RequestSpec {
  label: string;
  slug: string;
  method: string;
  url: string;
  body?: unknown;
}

function hashKey(method: string, url: string, body: unknown): string {
  const canon = JSON.stringify({ method, url, body: body ?? null });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

function sanitizeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Strip live credentials from a captured body before writing to disk.
 * Currently scrubs:
 *   - the top-level `APIKEY` field on /api/config (the server's auth key)
 *   - each `Providers[].api_key` field on /api/config (per-provider keys)
 * Anything else is passed through untouched.
 */
function redactResponseBody(url: string, body: string): string {
  if (!url.endsWith("/api/config")) return body;
  try {
    const data = JSON.parse(body) as Record<string, unknown> & {
      Providers?: { api_key?: unknown }[];
    };
    if (typeof data.APIKEY === "string" && data.APIKEY) {
      data.APIKEY = "***REDACTED***";
    }
    for (const p of data.Providers ?? []) {
      if (typeof p.api_key === "string" && p.api_key) {
        p.api_key = "***REDACTED***";
      }
    }
    return `${JSON.stringify(data)}`;
  } catch {
    return body;
  }
}

async function capture(spec: RequestSpec): Promise<"recorded" | "skipped" | "failed"> {
  const key = hashKey(spec.method, spec.url, spec.body);
  const dir = join(FIXTURES_DIR, `${sanitizeSlug(spec.slug)}.${key}`);
  const requestPath = join(dir, "request.json");
  const responsePath = join(dir, "response.json");
  const bodyPath = join(dir, "response.body");
  if (existsSync(requestPath) && existsSync(responsePath) && existsSync(bodyPath) && !FORCE) {
    console.log(`skip  ${spec.label}`);
    return "skipped";
  }

  const init: RequestInit = {
    method: spec.method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CCR_APIKEY,
      "anthropic-version": "2023-06-01",
      // Force identity encoding — Bun fetch's streaming gzip decoder
      // chokes on chunked-compressed SSE bodies (ZlibError) when CCR
      // proxies upstream responses (e.g. claude-code via Cloudflare).
      "Accept-Encoding": "identity",
    },
  };
  if (spec.body !== undefined) {
    init.body = JSON.stringify(spec.body);
  }

  try {
    const res = await fetch(spec.url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const rawBody = await res.text();
    const body = redactResponseBody(spec.url, rawBody);

    mkdirSync(dir, { recursive: true });
    writeFileSync(
      requestPath,
      `${JSON.stringify(
        {
          label: spec.label,
          method: spec.method,
          url: spec.url,
          body: spec.body ?? null,
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      responsePath,
      `${JSON.stringify(
        {
          status: res.status,
          statusText: res.statusText,
          headers,
        },
        null,
        2
      )}\n`
    );
    writeFileSync(bodyPath, body);
    console.log(
      `ok    ${spec.label} -> ${dir.split("/").slice(-2).join("/")}/ (status=${res.status}, ${body.length} bytes)`
    );
    return "recorded";
  } catch (e) {
    console.error(`FAIL  ${spec.label}: ${(e as Error).message}`);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Build the request matrix.
// Mirrors the exact bodies sent by __tests__/providers/*.test.ts so the
// captured fixtures can be replayed without rerunning the tests against
// a live server.
// ---------------------------------------------------------------------------

const messagesUrl = `${CCR_BASE}/v1/messages`;
const configUrl = `${CCR_BASE}/api/config`;

const specs: RequestSpec[] = [];

// /api/config — used by helpers.fetchSubscriptionModels to load the
// subscription model matrix.
specs.push({
  label: "GET /api/config",
  slug: "api-config",
  method: "GET",
  url: configUrl,
});

// openai test matrix (see __tests__/providers/openai.test.ts)
interface OpenaiTest {
  model: string;
  variants: ("stream-hello" | "stream-pong" | "nonstream-42")[];
}
const openaiTests: OpenaiTest[] = [
  { model: "gpt-4.1-mini", variants: ["stream-hello", "stream-pong", "nonstream-42"] },
  { model: "gpt-4.1", variants: ["stream-hello"] },
  { model: "gpt-5.5", variants: ["stream-hello", "stream-pong"] },
  { model: "gpt-5.4", variants: ["stream-hello", "stream-pong", "nonstream-42"] },
  { model: "gpt-5.3-codex", variants: ["stream-hello", "stream-pong"] },
];
for (const { model, variants } of openaiTests) {
  for (const v of variants) {
    const body = openaiBody(model, v);
    specs.push({
      label: `openai/${model}: ${v}`,
      slug: `openai-${model}-${v}`,
      method: "POST",
      url: messagesUrl,
      body,
    });
  }
}

function openaiBody(model: string, variant: string) {
  switch (variant) {
    case "stream-hello":
      return {
        model: `openai,${model}`,
        max_tokens: 100,
        messages: [{ role: "user", content: "Say exactly: hello" }],
        stream: true,
      };
    case "stream-pong":
      return {
        model: `openai,${model}`,
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
        stream: true,
      };
    case "nonstream-42":
      return {
        model: `openai,${model}`,
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with only the number 42." }],
        stream: false,
      };
    default:
      throw new Error(`unknown variant ${variant}`);
  }
}

// gemini test matrix (see __tests__/providers/gemini.test.ts)
interface GeminiTest {
  model: string;
  variants: ("stream-hello" | "stream-pong" | "nonstream-42")[];
}
const geminiTests: GeminiTest[] = [
  { model: "gemini-2.5-flash", variants: ["stream-hello", "stream-pong", "nonstream-42"] },
  { model: "gemini-2.5-pro", variants: ["stream-hello"] },
  { model: "gemini-3.1-pro-preview", variants: ["stream-hello", "stream-pong"] },
];
for (const { model, variants } of geminiTests) {
  for (const v of variants) {
    specs.push({
      label: `google/${model}: ${v}`,
      slug: `google-${model}-${v}`,
      method: "POST",
      url: messagesUrl,
      body: geminiBody(model, v),
    });
  }
}

function geminiBody(model: string, variant: string) {
  switch (variant) {
    case "stream-hello":
      return {
        model: `google,${model}`,
        max_tokens: 100,
        messages: [{ role: "user", content: "Say exactly: hello" }],
        stream: true,
      };
    case "stream-pong":
      return {
        model: `google,${model}`,
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
        stream: true,
      };
    case "nonstream-42":
      return {
        model: `google,${model}`,
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with only the number 42." }],
        stream: false,
      };
    default:
      throw new Error(`unknown variant ${variant}`);
  }
}

// subscription providers (claude-code, codex) — the test matrix is
// derived from /api/config at runtime, so we enumerate the live
// matrix here too and emit one smoke fixture per enabled model.
async function loadSubscriptionMatrix(): Promise<{ name: string; models: string[] }[]> {
  const res = await fetch(configUrl, { headers: { "x-api-key": CCR_APIKEY } });
  if (!res.ok) {
    throw new Error(`GET /api/config -> HTTP ${res.status}`);
  }
  const cfg = (await res.json()) as {
    Providers?: {
      name: string;
      auth_mode?: string;
      models?: string[];
      transformer?: { _disabledModels?: string[] };
    }[];
  };
  const out: { name: string; models: string[] }[] = [];
  for (const p of cfg.Providers ?? []) {
    if (p.auth_mode !== "subscription") continue;
    const disabled = new Set(p.transformer?._disabledModels ?? []);
    out.push({
      name: p.name,
      models: (p.models ?? []).filter((m) => !disabled.has(m)),
    });
  }
  return out;
}

const matrix = await loadSubscriptionMatrix();
for (const { name, models } of matrix) {
  for (const model of models) {
    specs.push({
      label: `${name}/${model}: subscription smoke`,
      slug: `${name}-${model}-smoke`,
      method: "POST",
      url: messagesUrl,
      body: {
        model: `${name},${model}`,
        max_tokens: 64,
        messages: [{ role: "user", content: "Reply with the word 'pong' only." }],
        stream: true,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-provider scenarios (richer than the hello/pong/42 smokes).
//
// One representative cheap model per provider class so each transformer's
// scenario round-trip is captured. Pick a model per concern:
//
//   tool-use     openai gpt-4.1-mini, google gemini-2.5-flash, claude-code haiku-4-5, codex gpt-5.5
//   system       openai gpt-4.1-mini, google gemini-2.5-flash, claude-code haiku-4-5
//   multi-turn   openai gpt-4.1-mini, google gemini-2.5-flash, claude-code haiku-4-5
//   thinking     claude-code opus-4-7 (extended thinking is anthropic-specific)
//
// Bodies are written in Anthropic wire shape — that's what CCR's /v1/messages
// endpoint receives, regardless of upstream provider.
// ---------------------------------------------------------------------------

interface ScenarioModel {
  provider: string;
  model: string;
}

const TOOL_USE_TARGETS: ScenarioModel[] = [
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "google", model: "gemini-2.5-flash" },
  { provider: "claude-code", model: "claude-haiku-4-5" },
  { provider: "codex", model: "gpt-5.5" },
];
const SYSTEM_TARGETS: ScenarioModel[] = [
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "google", model: "gemini-2.5-flash" },
  { provider: "claude-code", model: "claude-haiku-4-5" },
];
const MULTI_TURN_TARGETS: ScenarioModel[] = [
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "google", model: "gemini-2.5-flash" },
  { provider: "claude-code", model: "claude-haiku-4-5" },
];
const THINKING_TARGETS: ScenarioModel[] = [{ provider: "claude-code", model: "claude-opus-4-7" }];

function toolUseBody({ provider, model }: ScenarioModel) {
  return {
    model: `${provider},${model}`,
    max_tokens: 256,
    messages: [
      {
        role: "user",
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
    stream: true,
  };
}

function systemBody({ provider, model }: ScenarioModel) {
  return {
    model: `${provider},${model}`,
    max_tokens: 50,
    system: "You ONLY ever reply with the single word: pizza. No punctuation, no other text.",
    messages: [{ role: "user", content: "What is your favorite food?" }],
    stream: true,
  };
}

function multiTurnBody({ provider, model }: ScenarioModel) {
  return {
    model: `${provider},${model}`,
    max_tokens: 50,
    messages: [
      { role: "user", content: "My favorite number is 17. Please remember it." },
      { role: "assistant", content: "Got it — your favorite number is 17." },
      { role: "user", content: "What is my favorite number? Reply with only the number." },
    ],
    stream: true,
  };
}

function thinkingBody({ provider, model }: ScenarioModel) {
  return {
    model: `${provider},${model}`,
    max_tokens: 2048,
    thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [
      {
        role: "user",
        content: "What is 23 * 47? Think it through step by step, then give the final number only.",
      },
    ],
    stream: true,
  };
}

for (const target of TOOL_USE_TARGETS) {
  specs.push({
    label: `${target.provider}/${target.model}: tool-use weather`,
    slug: `${target.provider}-${target.model}-tool-use`,
    method: "POST",
    url: messagesUrl,
    body: toolUseBody(target),
  });
}
for (const target of SYSTEM_TARGETS) {
  specs.push({
    label: `${target.provider}/${target.model}: system prompt`,
    slug: `${target.provider}-${target.model}-system`,
    method: "POST",
    url: messagesUrl,
    body: systemBody(target),
  });
}
for (const target of MULTI_TURN_TARGETS) {
  specs.push({
    label: `${target.provider}/${target.model}: multi-turn memory`,
    slug: `${target.provider}-${target.model}-multi-turn`,
    method: "POST",
    url: messagesUrl,
    body: multiTurnBody(target),
  });
}
for (const target of THINKING_TARGETS) {
  specs.push({
    label: `${target.provider}/${target.model}: extended thinking`,
    slug: `${target.provider}-${target.model}-thinking`,
    method: "POST",
    url: messagesUrl,
    body: thinkingBody(target),
  });
}

// ---------------------------------------------------------------------------
// Temporary api_key injection.
// The openai / google providers ship to the DB with api_key=null. We pull
// OPENAI_API_KEY / GEMINI_API_KEY from .env, POST them into the live DB
// before recording, then restore the previous (typically null) values so
// the script leaves no residue. Subscription providers are untouched.
// Skip the inject step entirely with NO_INJECT=1.
// ---------------------------------------------------------------------------

interface InjectionState {
  // provider name -> prior api_key value (null when previously unset)
  prior: Record<string, string | null>;
}

async function fetchFullConfig(): Promise<Record<string, unknown> & {
  Providers?: { name: string; api_key: string | null }[];
}> {
  const res = await fetch(configUrl, {
    headers: { "x-api-key": CCR_APIKEY, "Accept-Encoding": "identity" },
  });
  if (!res.ok) throw new Error(`GET /api/config -> HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown> & {
    Providers?: { name: string; api_key: string | null }[];
  };
}

async function postProvidersUpdate(providers: { name: string; api_key: string | null }[]): Promise<void> {
  // POST the full Providers array — applyUiConfig deletes any provider
  // missing from the payload, so we round-trip the whole list.
  const res = await fetch(configUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CCR_APIKEY,
      "Accept-Encoding": "identity",
    },
    body: JSON.stringify({ Providers: providers }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /api/config -> HTTP ${res.status}: ${text}`);
  }
}

const INJECTION_TARGETS: { provider: string; envVar: string }[] = [
  { provider: "openai", envVar: "OPENAI_API_KEY" },
  { provider: "google", envVar: "GEMINI_API_KEY" },
];

async function injectApiKeys(): Promise<InjectionState | null> {
  if (process.env.NO_INJECT) {
    console.log("inject: skipped (NO_INJECT set)");
    return null;
  }

  const cfg = await fetchFullConfig();
  const providers = cfg.Providers ?? [];
  const prior: Record<string, string | null> = {};
  let changed = false;

  for (const { provider, envVar } of INJECTION_TARGETS) {
    const value = process.env[envVar];
    if (!value) {
      console.log(`inject: ${envVar} not set, skipping ${provider}`);
      continue;
    }
    const row = providers.find((p) => p.name === provider);
    if (!row) {
      console.log(`inject: provider "${provider}" not in /api/config, skipping`);
      continue;
    }
    prior[provider] = row.api_key;
    row.api_key = value;
    changed = true;
    console.log(`inject: ${provider}.api_key set from ${envVar}`);
  }

  if (!changed) return null;
  await postProvidersUpdate(providers);
  return { prior };
}

async function restoreApiKeys(state: InjectionState): Promise<void> {
  const cfg = await fetchFullConfig();
  const providers = cfg.Providers ?? [];
  for (const [name, prevValue] of Object.entries(state.prior)) {
    const row = providers.find((p) => p.name === name);
    if (!row) continue;
    row.api_key = prevValue;
    console.log(`restore: ${name}.api_key reset to ${prevValue === null ? "null" : "<prior value>"}`);
  }
  await postProvidersUpdate(providers);
}

// ---------------------------------------------------------------------------
// Capture loop.
// ---------------------------------------------------------------------------

const matching = filter
  ? specs.filter((s) => s.slug.startsWith(filter))
  : specs;
if (filter) console.log(`filter: ${filter} (${matching.length}/${specs.length} specs)`);

let injection: InjectionState | null = null;
try {
  injection = await injectApiKeys();
} catch (e) {
  console.error(`inject failed: ${(e as Error).message}`);
  process.exit(1);
}

const counts = { recorded: 0, skipped: 0, failed: 0 };
try {
  for (const spec of matching) {
    const result = await capture(spec);
    counts[result]++;
  }
} finally {
  if (injection) {
    try {
      await restoreApiKeys(injection);
    } catch (e) {
      console.error(
        `restore failed: ${(e as Error).message} — re-run with NO_INJECT=1 once the keys are cleared manually`
      );
    }
  }
}

console.log(
  `\nDone: ${counts.recorded} recorded, ${counts.skipped} skipped, ${counts.failed} failed`
);
if (counts.failed > 0) process.exit(1);
