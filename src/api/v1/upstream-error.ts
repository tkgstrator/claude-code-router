/**
 * Upstream-error helpers shared by the /v1 route and its chain walker.
 *
 * The vendored llms pipeline throws a single HTTPException shape on
 * upstream failure ("Error from provider(<name>,<model>: <status>):
 * <rawBody>"); this module parses that shape and decides whether the
 * error should be forwarded verbatim to the client, treated as a
 * rate-limit and failed over, or used to drive the effort-level retry
 * dance against the same model.
 */

import { HTTPException } from 'hono/http-exception'

// sendToProvider throws an HTTPException with the exact message
// "Error from provider(<name>,<model>: <status>): <rawBody>" so the
// client sees the genuine upstream error (e.g. Anthropic rate_limit_error)
// rather than our re-wrapped one. Fail fast.
const PROVIDER_ERR_RE = /^Error from provider\([^)]*:\s*(\d+)\):\s*([\s\S]*)$/

// Repackage the parsed provider error as a real Response the client can
// receive. Returns null when the error is not the provider-shaped one
// (caller should treat as a pipeline error and surface a generic 5xx).
export function forwardUpstreamError(err: unknown): Response | null {
  if (!(err instanceof HTTPException)) return null
  const message = err.message
  const m = message.match(PROVIDER_ERR_RE)
  if (!m) return null
  const status = Number(m[1]) || err.status || 502
  return new Response(m[2], { status, headers: { 'content-type': 'application/json' } })
}

// Upstream statuses that mean "this model can't serve right now, move to
// the next fallback": 429 is the subscription / plan rate-limit ceiling
// the user hits. Kept narrow on purpose — genuine 4xx (bad request,
// auth) should surface, not silently re-route.
const FAILOVER_STATUSES = new Set([429])

export function isRateLimited(err: unknown): boolean {
  if (!(err instanceof HTTPException)) return false
  const m = err.message.match(PROVIDER_ERR_RE)
  const status = m ? Number(m[1]) : err.status
  return FAILOVER_STATUSES.has(status)
}

// ─── Effort-level retry helpers ─────────────────────────────────────────

// Canonical effort ordering low→high; used to rank the "supported
// levels" the upstream advertises in its 400 message so we can pick the
// highest tier the model accepts when downgrading.
const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// Parse the "does not support effort level 'X'. Supported levels: a, b,
// c" message Anthropic emits on a 400 and surface the highest supported
// level. Returns null when the message doesn't match the expected
// shape; the caller bails out and forwards the original error.
export function bestSupportedLevel(message: string | undefined): { bad: string; level: string } | null {
  const m = message?.match(/does not support effort level '([^']+)'\.\s*Supported levels:\s*([^"}\n]+)/i)
  if (!m) return null
  const supported = m[2]
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (supported.length === 0) return null
  const level =
    [...supported].sort(
      (a, b) =>
        EFFORT_LADDER.indexOf(b as (typeof EFFORT_LADDER)[number]) -
        EFFORT_LADDER.indexOf(a as (typeof EFFORT_LADDER)[number])
    )[0] ?? supported[0]
  return { bad: m[1], level }
}

// Walk `node` and replace every `=== from` slot with `to`. Used to
// rewrite an effort-level string anywhere it appears in the request
// body (top-level output_config.effort + nested duplicates) before the
// retry. Returns true when at least one slot changed so the caller can
// skip a no-op retry.
export function deepReplaceValue(node: unknown, from: string, to: string): boolean {
  if (!node || typeof node !== 'object') return false
  const obj = node as Record<string | number, unknown>
  const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(obj)
  let changed = false
  for (const k of keys) {
    if (obj[k] === from) {
      obj[k] = to
      changed = true
    } else if (deepReplaceValue(obj[k], from, to)) {
      changed = true
    }
  }
  return changed
}
