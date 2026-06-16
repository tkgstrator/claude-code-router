import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

// SHA-256 both sides before comparing: fixed-length digests make
// timingSafeEqual safe (it throws on length mismatch and would
// otherwise leak the secret's length).
const digest = (s: string): Buffer => createHash('sha256').update(s).digest()

// Routes that accept the API key as an `apikey` URL query parameter in
// addition to the standard `x-api-key` / `Authorization: Bearer` headers.
// EventSource cannot send custom headers so SSE endpoints have to take
// the key on the URL, but exposing it on every route would mean
// accidental leakage via access logs, browser history, and the Referer
// header. Keep this allow-list as narrow as possible — only the
// EventSource endpoints that genuinely need it.
const ALLOW_API_KEY_QUERY_PARAM = new Set<string>(['/api/request-logs/events'])

// Gate the billable proxy + config API behind the envelope APIKEY
// (mirrored onto process.env by initConfig; bootstrap mints one on
// first run so this never silently runs open). Accepts the secret as
// `x-api-key` header or `Authorization: Bearer <key>` header on every
// gated route; the `apikey` query param is accepted only on the
// SSE/EventSource paths in ALLOW_API_KEY_QUERY_PARAM. Fails closed.
export const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  const expected = (process.env.APIKEY ?? '').trim()
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  const queryKey = ALLOW_API_KEY_QUERY_PARAM.has(c.req.path) ? c.req.query('apikey') : undefined
  const provided = (c.req.header('x-api-key') ?? bearer ?? queryKey ?? '').trim()

  const ok = expected.length > 0 && provided.length > 0 && timingSafeEqual(digest(provided), digest(expected))

  if (!ok) {
    return c.json(
      { type: 'error', error: { type: 'authentication_error', message: 'Invalid or missing API key' } },
      401
    )
  }
  return next()
}
