import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

// SHA-256 both sides before comparing: fixed-length digests make
// timingSafeEqual safe (it throws on length mismatch and would
// otherwise leak the secret's length).
const digest = (s: string): Buffer => createHash('sha256').update(s).digest()

// Gate the billable proxy + config API behind the envelope APIKEY
// (mirrored onto process.env by initConfig; bootstrap mints one on
// first run so this never silently runs open). Accepts the secret as
// `x-api-key` header, `Authorization: Bearer <key>` header, or the
// `apikey` query param (SSE/EventSource endpoints can't send headers).
// Fails closed.
export const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  const expected = (process.env.APIKEY ?? '').trim()
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  const provided = (c.req.header('x-api-key') ?? bearer ?? c.req.query('apikey') ?? '').trim()

  const ok = expected.length > 0 && provided.length > 0 && timingSafeEqual(digest(provided), digest(expected))

  if (!ok) {
    return c.json(
      { type: 'error', error: { type: 'authentication_error', message: 'Invalid or missing API key' } },
      401
    )
  }
  return next()
}
