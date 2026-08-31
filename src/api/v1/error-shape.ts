/**
 * Error-envelope shaping for /v1 responses.
 *
 * Rialto fronts three client conventions on the same pipeline:
 *
 *   - Anthropic (/v1/messages) callers expect
 *     `{ type: 'error', error: { type, message } }`.
 *   - OpenAI-compat callers (/v1/chat/completions, /v1/responses,
 *     /v1/models) expect
 *     `{ error: { message, type, code, param? } }`.
 *   - Google (/v1beta/models/*) callers expect
 *     `{ error: { code, message, status } }`, where `status` is a
 *     google.rpc.Code name and `code` is the HTTP status as a number.
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

import { catalogPathFor, type SurfaceErrorShape, surfaceForPath } from '@/llms/inbound/surfaces'
import { isObject } from '@/llms/utils/guards'

// ─── Shape resolution ─────────────────────────────────────────────────

export type ErrorShape = SurfaceErrorShape

export function errorShapeForPath(path: string | undefined): ErrorShape {
  const surface = surfaceForPath(path)
  if (surface !== undefined) return surface.errorShape
  // `/v1/models` is a catalog read rather than a completion surface, so
  // it is not in the surface registry — but its callers are OpenAI SDKs
  // and it must answer in their envelope.
  const catalog = catalogPathFor(path)
  if (catalog !== undefined) return catalog.errorShape
  // A path outside both registries can only be reached by the /v1/*
  // catch-all answering 404. Anthropic is what it has always answered.
  return 'anthropic'
}

// ─── Wire-body extraction ─────────────────────────────────────────────

interface ExtractedUpstream {
  message: string
  type?: string
  code?: string
  param?: string | null
  // Google's classifier lives on `error.status` as a google.rpc.Code
  // name. Kept apart from `type` because the two taxonomies do not
  // overlap — feeding INVALID_ARGUMENT into OpenAI's `error.type` would
  // hand an OpenAI SDK a string it cannot match on.
  status?: string
}

// Pull a human-readable message + optional vendor classifiers out of
// whatever the upstream returned. Recognises:
//   - OpenAI:    `{ error: { message, type, code, param } }`
//   - Google:    `{ error: { code, message, status } }`
//   - Codex:     `{ detail: "..." }`
//   - Anthropic: `{ type: 'error', error: { type, message } }`
//   - Plain string / unknown JSON: stringified
function extractUpstream(raw: unknown): ExtractedUpstream {
  if (typeof raw === 'string') return { message: raw }
  if (raw === null || typeof raw !== 'object') return { message: String(raw ?? '') }
  const obj = raw as Record<string, unknown>

  // OpenAI: { error: { message, type, code, param } }
  // Google: { error: { code: <number>, message, status } } — same slot,
  // different fields, so both are read off the one branch.
  if (isObject(obj.error)) {
    const inner = obj.error as Record<string, unknown>
    if (typeof inner.message === 'string') {
      const out: ExtractedUpstream = { message: inner.message }
      if (typeof inner.type === 'string') out.type = inner.type
      if (typeof inner.code === 'string') out.code = inner.code
      if (typeof inner.status === 'string') out.status = inner.status
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

// google.rpc.Code names for the HTTP statuses Google's own APIs map
// them from. The Google GenAI SDKs surface `error.status` verbatim, and
// client code branches on it (RESOURCE_EXHAUSTED for a quota retry,
// UNAUTHENTICATED for a re-login), so an invented string is worse than
// UNKNOWN — which is the canonical name for "no mapping".
function googleStatusForCode(status: number, fallback: string | undefined): string {
  if (fallback !== undefined) return fallback
  if (status === 400) return 'INVALID_ARGUMENT'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'PERMISSION_DENIED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'ABORTED'
  if (status === 429) return 'RESOURCE_EXHAUSTED'
  if (status === 499) return 'CANCELLED'
  if (status === 500) return 'INTERNAL'
  if (status === 501) return 'UNIMPLEMENTED'
  if (status === 503) return 'UNAVAILABLE'
  if (status === 504) return 'DEADLINE_EXCEEDED'
  return 'UNKNOWN'
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
  // Provider name the upstream error came through, when the caller
  // knows it. Prepended to the visible message as `[via <name>] ` so a
  // chained-CCR 401 (whose literal 'Invalid or missing API key. Send it
  // as Authorization: Bearer <key>.' collides with the local gate's
  // wording byte-for-byte) tells the operator which CCR rejected. Absent
  // for callers that didn't resolve to a specific provider yet.
  via?: string
}

// Prepend `[via <name>] ` to a message once. Idempotent — nested CCRs
// each add their own hop, but re-forwarding the same envelope in the
// same layer would not double-tag. Returns the original message when
// `via` is empty / undefined.
function withVia(message: string, via: string | undefined): string {
  if (via === undefined || via.length === 0) return message
  const tag = `[via ${via}] `
  return message.startsWith(tag) ? message : tag + message
}

// Compose the shape-appropriate error envelope. Returns the parsed body
// (as an object) — callers construct the `Response` themselves so they
// keep control of headers (x-request-id, content-type, Retry-After).
export function buildErrorEnvelope({ shape, status, from, via }: BuildErrorEnvelopeInput): Record<string, unknown> {
  const extracted = typeof from === 'string' ? { message: from } : extractUpstream(from)
  const message = withVia(extracted.message, via)
  if (shape === 'openai') {
    const envelope: Record<string, unknown> = {
      error: {
        message,
        type: openaiTypeForStatus(status, extracted.type),
        param: extracted.param ?? null,
        code: extracted.code ?? null
      }
    }
    return envelope
  }
  if (shape === 'google') {
    // `code` is the HTTP status as a number, not a string — that is what
    // google.rpc.Status carries and what the GenAI SDKs read.
    return {
      error: {
        code: status,
        message,
        status: googleStatusForCode(status, extracted.status)
      }
    }
  }
  return {
    type: 'error',
    error: {
      type: anthropicTypeForStatus(status, extracted.type),
      message
    }
  }
}
