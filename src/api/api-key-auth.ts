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

interface ApiKeyAuthOptions {
  // OpenAI-shape endpoints (/v1/chat/completions, /v1/responses,
  // /v1/models) mint their key from `Authorization: Bearer` only —
  // `x-api-key` is an Anthropic convention and accepting it on an
  // OpenAI-compat surface leaks the two conventions into each other.
  bearerOnly?: boolean
  // Error envelope shape. Anthropic-style clients (Claude Code) expect
  // `{type: 'error', error: {type, message}}`; OpenAI SDK / Codex CLI /
  // Cline expect `{error: {message, type, code}}`. The wire body diverges
  // even though the 401 status is identical.
  errorShape?: 'anthropic' | 'openai'
}

function unauthorizedResponse(shape: 'anthropic' | 'openai'): {
  status: 401
  body: Record<string, unknown>
} {
  if (shape === 'openai') {
    return {
      status: 401,
      body: {
        error: {
          message: 'Invalid or missing API key. Send it as Authorization: Bearer <key>.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_api_key'
        }
      }
    }
  }
  return {
    status: 401,
    body: { type: 'error', error: { type: 'authentication_error', message: 'Invalid or missing API key' } }
  }
}

// Gate the billable proxy + config API behind the envelope APIKEY
// (mirrored onto process.env by initConfig; bootstrap mints one on
// first run so this never silently runs open). Accepts the secret as
// `x-api-key` header or `Authorization: Bearer <key>` header on every
// gated route; the `apikey` query param is accepted only on the
// SSE/EventSource paths in ALLOW_API_KEY_QUERY_PARAM. Fails closed.
export function createApiKeyAuth(options: ApiKeyAuthOptions = {}): MiddlewareHandler {
  const bearerOnly = options.bearerOnly === true
  const errorShape = options.errorShape ?? (bearerOnly ? 'openai' : 'anthropic')
  return async (c, next) => {
    const expected = (process.env.APIKEY ?? '').trim()
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
    const queryKey = ALLOW_API_KEY_QUERY_PARAM.has(c.req.path) ? c.req.query('apikey') : undefined
    const xApiKey = bearerOnly ? undefined : c.req.header('x-api-key')
    const provided = (xApiKey ?? bearer ?? queryKey ?? '').trim()

    const ok = expected.length > 0 && provided.length > 0 && timingSafeEqual(digest(provided), digest(expected))

    if (!ok) {
      const err = unauthorizedResponse(errorShape)
      return c.json(err.body, err.status)
    }
    return next()
  }
}

export const apiKeyAuth: MiddlewareHandler = createApiKeyAuth()
// OpenAI-compat surface: reject x-api-key (Anthropic convention) and
// emit an OpenAI-shape error envelope on 401.
export const openaiBearerAuth: MiddlewareHandler = createApiKeyAuth({ bearerOnly: true })
