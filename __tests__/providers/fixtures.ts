/**
 * Record/replay layer for the provider integration tests.
 *
 * Each captured interaction lives in its own directory under
 * `__fixtures__/`, named `<slug>.<hash8>` where the hash is
 * sha256(method+url+body) sliced to 16 chars. The directory carries
 * three files so a human can diff the raw SSE without unescaping JSON:
 *
 *   <slug>.<hash>/
 *     request.json    { method, url, body, label }
 *     response.json   { status, statusText, headers }
 *     response.body   raw response text (SSE or JSON)
 *
 * Default mode is `replay` — every fetch is served from disk. Set
 * `CCR_FIXTURE_MODE=live` to bypass and hit the running CCR server
 * (default http://127.0.0.1:16173, override with CCR_TEST_URL).
 *
 * Fixtures are produced by `scripts/capture-fixtures.ts`; rerun that
 * to refresh them after a transformer change.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

export type FixtureMode = "replay" | "live";
export const FIXTURE_MODE: FixtureMode =
  (process.env.CCR_FIXTURE_MODE as FixtureMode) ?? "replay";

interface ResponseMeta {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
}

// Headers that would lie if we forwarded them on a replayed body:
//   - content-encoding: the saved body is already plain text
//   - content-length: Response recomputes; original byte count is wrong
//   - transfer-encoding / connection / keep-alive: hop-by-hop noise
const STRIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "te",
  "trailer",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
]);

export function hashRequest(method: string, url: string, body: unknown): string {
  const canon = JSON.stringify({ method, url, body: body ?? null });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

let cachedDirs: string[] | null = null;
function listFixtureDirs(): string[] {
  if (cachedDirs) return cachedDirs;
  if (!existsSync(FIXTURES_DIR)) return (cachedDirs = []);
  cachedDirs = readdirSync(FIXTURES_DIR).filter((name) => {
    try {
      return statSync(join(FIXTURES_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
  return cachedDirs;
}

function findFixtureDir(hash: string): string | null {
  const suffix = `.${hash}`;
  for (const name of listFixtureDirs()) {
    if (name.endsWith(suffix)) return join(FIXTURES_DIR, name);
  }
  return null;
}

function loadFixture(hash: string): { meta: ResponseMeta; body: string } | null {
  const dir = findFixtureDir(hash);
  if (!dir) return null;
  const metaPath = join(dir, "response.json");
  const bodyPath = join(dir, "response.body");
  if (!existsSync(metaPath) || !existsSync(bodyPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ResponseMeta;
  const body = readFileSync(bodyPath, "utf8");
  return { meta, body };
}

function buildResponse(meta: ResponseMeta, body: string): Response {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta.headers)) {
    if (STRIP_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  return new Response(body, {
    status: meta.status,
    statusText: meta.statusText ?? "",
    headers,
  });
}

/**
 * Drop-in replacement for `fetch` that loads from fixtures by default
 * and falls through to the live server when CCR_FIXTURE_MODE=live.
 *
 * Body shape note: when `init.body` is a string, we JSON.parse it to
 * canonicalise the hash key (so an extra space in the wire JSON would
 * still match a captured fixture). Non-JSON string bodies hash as the
 * raw string.
 */
export async function cachedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (FIXTURE_MODE === "live") return fetch(url, init);

  const method = (init.method ?? "GET").toUpperCase();
  let body: unknown = null;
  if (typeof init.body === "string" && init.body.length > 0) {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }

  const hash = hashRequest(method, url, body);
  const cached = loadFixture(hash);
  if (cached) return buildResponse(cached.meta, cached.body);

  throw new Error(
    `No fixture for ${method} ${url} (hash=${hash}). ` +
      `Run with CCR_FIXTURE_MODE=live to bypass, or refresh fixtures via ` +
      `\`bun run scripts/capture-fixtures.ts\`.`
  );
}
