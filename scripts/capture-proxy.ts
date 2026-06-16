#!/usr/bin/env bun
/**
 * Capture proxy for Claude Code ↔ Anthropic traffic.
 *
 * Starts an HTTP server that forwards requests directly to Anthropic's API
 * and saves each request/response pair as a fixture (same format as
 * __tests__/providers/__fixtures__/).
 *
 * Usage:
 *   bun run scripts/capture-proxy.ts
 *
 * Then start Claude Code with:
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:18080 claude
 *
 * Fixtures are written to __tests__/providers/__fixtures__/ automatically.
 * Ctrl+C to stop.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PROXY_PORT ?? 18080);
const ANTHROPIC_BASE = process.env.ANTHROPIC_TARGET ?? "https://api.anthropic.com";
const FIXTURES_DIR = join(import.meta.dir, "..", "__tests__", "providers", "__fixtures__");
const PROXY_URL = `http://127.0.0.1:${PORT}`;

mkdirSync(FIXTURES_DIR, { recursive: true });

function hashRequest(method: string, url: string, body: unknown): string {
  const canon = JSON.stringify({ method, url, body: body ?? null });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

function sanitizeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function makeSlug(path: string, body: unknown): string {
  const model =
    typeof body === "object" && body !== null && "model" in body
      ? String((body as { model: unknown }).model).replace(/[^a-zA-Z0-9._-]/g, "-")
      : "unknown";
  const endpoint = path.replace(/^\//, "").replace(/\//g, "-");
  return sanitizeSlug(`${endpoint}-${model}`);
}

let requestCount = 0;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const targetUrl = `${ANTHROPIC_BASE}${url.pathname}${url.search}`;

    const method = req.method;
    const rawBody = method !== "GET" && method !== "HEAD" ? await req.text() : undefined;

    let parsedBody: unknown = null;
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    const proxyUrl = `${PROXY_URL}${url.pathname}`;
    const hash = hashRequest(method, proxyUrl, parsedBody);
    const slug = makeSlug(url.pathname, parsedBody);
    const dir = join(FIXTURES_DIR, `${slug}.${hash}`);
    const n = ++requestCount;

    console.log(`[${n}] → ${method} ${url.pathname} (${slug}.${hash})`);

    const forwardHeaders: Record<string, string> = {};
    for (const [k, v] of req.headers.entries()) {
      if (k.toLowerCase() === "host") continue;
      forwardHeaders[k] = v;
    }
    forwardHeaders["accept-encoding"] = "identity";

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method,
        headers: forwardHeaders,
        body: rawBody,
      });
    } catch (e) {
      console.error(`[${n}] fetch error: ${(e as Error).message}`);
      return new Response(`upstream error: ${(e as Error).message}`, { status: 502 });
    }

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });

    const responseBody = await res.text();

    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "request.json"),
      JSON.stringify({ label: slug, method, url: proxyUrl, body: parsedBody ?? null }, null, 2) + "\n"
    );
    writeFileSync(
      join(dir, "response.json"),
      JSON.stringify({ status: res.status, statusText: res.statusText, headers: resHeaders }, null, 2) + "\n"
    );
    writeFileSync(join(dir, "response.body"), responseBody);

    console.log(`[${n}] ← ${res.status} (${responseBody.length} bytes) → saved to ${slug}.${hash}/`);

    const replyHeaders: Record<string, string> = {};
    const STRIP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);
    for (const [k, v] of Object.entries(resHeaders)) {
      if (!STRIP.has(k.toLowerCase())) replyHeaders[k] = v;
    }

    return new Response(responseBody, {
      status: res.status,
      statusText: res.statusText,
      headers: replyHeaders,
    });
  },
});

console.log(`Capture proxy listening on http://127.0.0.1:${PORT}`);
console.log(`Forwarding to: ${ANTHROPIC_BASE}`);
console.log(`Fixtures dir:  ${FIXTURES_DIR}`);
console.log();
console.log(`Start Claude Code with:`);
console.log(`  ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} claude`);
console.log();
console.log("Press Ctrl+C to stop.");
