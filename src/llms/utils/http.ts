// Adapters between framework-native request shapes and the POJO IncomingRequest
// defined in types/http.ts.
//
// Phase 0 of the Hono+Vite migration uses these inside the Fastify wrapper so
// the public core entry points (router, agent.shouldHandle, agent.reqHandler)
// can be called with a plain object. The conversion is a thin copy — Fastify's
// FastifyRequest already structurally satisfies IncomingRequest at the field
// level, so the adapter exists mostly for clarity and to normalise headers
// into a Map.

import type { HttpHeaders, IncomingRequest, QueryParams, RouterRequest } from "../types/http";

const coerceHeaderValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
};

// Lower-cases keys to align with the HTTP/2 + Fetch convention.
const normaliseHeaders = (raw: unknown): HttpHeaders => {
  const out: HttpHeaders = new Map();
  // Fastify hands in IncomingHttpHeaders (Record-like with string | string[]
  // values). The Map shape collapses duplicates the way Fastify's downstream
  // consumers already expect (last write wins via Object.entries order).
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as { [k: string]: unknown })) {
      const v = coerceHeaderValue(value);
      if (v !== undefined) {
        out.set(key.toLowerCase(), v);
      }
    }
  }
  return out;
};

const parseQuery = (url: string): QueryParams => {
  const out: QueryParams = new Map();
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return out;
  const search = new URLSearchParams(url.slice(qIndex + 1));
  for (const [k, v] of search) {
    if (!out.has(k)) out.set(k, v);
  }
  return out;
};

interface FastifyLikeRequest {
  method?: string;
  url?: string;
  headers?: unknown;
  body?: unknown;
  id?: string;
  log?: IncomingRequest["log"];
}

// Build an IncomingRequest from anything that looks like a Fastify request
// (url/method/headers/body). Typed as `unknown` so the function can be reused
// for Node's IncomingMessage or a Hono context when those land.
export const toIncomingRequest = (raw: unknown): IncomingRequest => {
  const r: FastifyLikeRequest = raw && typeof raw === "object" ? (raw as FastifyLikeRequest) : {};
  const url = typeof r.url === "string" ? r.url : "/";
  const method = typeof r.method === "string" ? r.method : "GET";
  return {
    method,
    url,
    headers: normaliseHeaders(r.headers),
    body: r.body,
    query: parseQuery(url),
    id: r.id,
    log: r.log,
  };
};

// Same as toIncomingRequest but preserves the mutable RouterRequest fields the
// router/agent stack stamps onto the request (sessionId, scenarioType, etc.).
// The cast is the single structural assumption we accept here: the input is
// unknown by design, and the structural shape is enforced at use sites.
export const toRouterRequest = (raw: unknown): RouterRequest => {
  const base = toIncomingRequest(raw);
  const r: Partial<RouterRequest> = raw && typeof raw === "object" ? (raw as Partial<RouterRequest>) : {};
  const body: RouterRequest["body"] =
    base.body && typeof base.body === "object"
      ? (base.body as RouterRequest["body"])
      : ({ model: "" } as RouterRequest["body"]);
  return {
    ...base,
    body,
    sessionId: r.sessionId,
    scenarioType: r.scenarioType,
    tokenCount: r.tokenCount,
    provider: r.provider,
    model: r.model,
    preset: r.preset,
    agents: r.agents,
    pathname: r.pathname,
  };
};
