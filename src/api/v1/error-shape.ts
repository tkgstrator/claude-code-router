/**
 * Error-envelope shaping for /v1 responses.
 *
 * CCR fronts two client conventions on the same pipeline:
 *
 *   - Anthropic (/v1/messages) callers expect
 *     `{ type: 'error', error: { type, message } }`.
 *   - OpenAI-compat callers (/v1/chat/completions, /v1/responses,
 *     /v1/models) expect
 *     `{ error: { message, type, code, param? } }`.
 *
 * Before this module, `forwardUpstreamError` relayed whatever the
 * upstream returned verbatim — so a codex 400 sending
 * `{"detail":"Unsupported parameter: X"}` would reach an OpenAI SDK
 * client that didn't know how to parse it. Route-level `errorResponse`
 * only knew the Anthropic shape. The reporter's complaint was the
 * mixed envelope: `{detail}` from upstream and `{type,error}` from CCR
 * on the same OpenAI-compat surface.
 *
 * The helpers here take (a) an inbound path (or a `Transformer` name)
 * to derive the client's shape, (b) a status + message + optional
 * upstream body, and produce a `Response` in the matching envelope.
 * Upstream bodies in any of the three known shapes are re-wrapped
 * transparently — unknown JSON is inlined as `error.message` rather
 * than dropped, unknown non-JSON becomes the message string verbatim.
 */

// ─── Shape resolution ─────────────────────────────────────────────────

export type ErrorShape = 'openai' | 'anthropic'

// Endpoints that speak the OpenAI wire format. Anything else (currently
// only `/v1/messages` in this repo) defaults to the Anthropic shape,
// which is the pre-existing behaviour that predates the OpenAI-compat
// surface.
const OPENAI_INBOUND_PATHS = new Set(['/v1/chat/completions', '/v1/responses', '/v1/models'])

export function errorShapeForPath(path: string | undefined): ErrorShape {
  return typeof path === 'string' && OPENAI_INBOUND_PATHS.has(path) ? 'openai' : 'anthropic'
}

// ─── Wire-body extraction ─────────────────────────────────────────────

interface ExtractedUpstream {
  message: string
  type?: string
  code?: string
  param?: string | null
}

// Pull a human-readable message + optional OpenAI-flavour classifiers
// out of whatever the upstream returned. Recognises:
//   - OpenAI:    `{ error: { message, type, code, param } }`
//   - Codex:     `{ detail: "..." }`
//   - Anthropic: `{ type: 'error', error: { type, message } }`
//   - Plain string / unknown JSON: stringified
function extractUpstream(raw: unknown): ExtractedUpstream {
  if (typeof raw === 'string') return { message: raw }
  if (raw === null || typeof raw !== 'object') return { message: String(raw ?? '') }
  const obj = raw as Record<string, unknown>

  // OpenAI: { error: { message, type, code, param } }
  if (isObject(obj.error)) {
    const inner = obj.error as Record<string, unknown>
    if (typeof inner.message === 'string') {
      const out: ExtractedUpstream = { message: inner.message }
      if (typeof inner.type === 'string') out.type = inner.type
      if (typeof inner.code === 'string') out.code = inner.code
      if (typeof inner.param === 'string' || inner.param === null) out.param = inner.param as string | null
      return out
    }
  }

  // Codex: { detail: "..." }
  if (typeof obj.detail === 'string') return { message: obj.detail }

  // Anthropic: { type:'error', error:{ type, message } } (error already
  // handled above); some Anthropic variants use { message } at top level.
  if (typeof obj.message === 'string') return { message: obj.message }

  // Unknown JSON shape — stringify so the client at least sees the
  // upstream detail rather than a generic "internal error".
  return { message: JSON.stringify(obj) }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Try to parse an upstream response body as JSON; fall back to the raw
// string when the upstream returned HTML / plaintext.
export function parseUpstreamBody(rawText: string): unknown {
  if (rawText.length === 0) return { message: 'Empty response from upstream' }
  try {
    return JSON.parse(rawText)
  } catch {
    return rawText
  }
}

// ─── Envelope builders ───────────────────────────────────────────────

// OpenAI's canonical taxonomy for `error.type`. When the upstream didn't
// classify the error itself, guess by status code so the client sees a
// stable string it can pattern-match on.
function openaiTypeForStatus(status: number, fallback: string | undefined): string {
  if (fallback !== undefined) return fallback
  if (status === 400) return 'invalid_request_error'
  if (status === 401) return 'authentication_error'
  if (status === 403) return 'permission_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  if (status >= 500) return 'api_error'
  return 'invalid_request_error'
}

function anthropicTypeForStatus(status: number, fallback: string | undefined): string {
  if (fallback !== undefined) return fallback
  if (status === 400) return 'invalid_request_error'
  if (status === 401) return 'authentication_error'
  if (status === 403) return 'permission_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  return 'api_error'
}

export interface BuildErrorEnvelopeInput {
  shape: ErrorShape
  status: number
  // Either a plain string message or a parsed upstream body — the
  // helper unwraps the latter via `extractUpstream`.
  from: string | Record<string, unknown> | unknown
}

// Compose the shape-appropriate error envelope. Returns the parsed body
// (as an object) — callers construct the `Response` themselves so they
// keep control of headers (x-request-id, content-type, Retry-After).
export function buildErrorEnvelope({ shape, status, from }: BuildErrorEnvelopeInput): Record<string, unknown> {
  const extracted = typeof from === 'string' ? { message: from } : extractUpstream(from)
  if (shape === 'openai') {
    const envelope: Record<string, unknown> = {
      error: {
        message: extracted.message,
        type: openaiTypeForStatus(status, extracted.type),
        param: extracted.param ?? null,
        code: extracted.code ?? null
      }
    }
    return envelope
  }
  return {
    type: 'error',
    error: {
      type: anthropicTypeForStatus(status, extracted.type),
      message: extracted.message
    }
  }
}
