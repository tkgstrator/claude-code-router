import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import './context'
import { surfaceForPath } from '../llms/inbound/surfaces'
import { noteTokenUse, resolveAccessToken } from '../services/access-token-service'
import { readAccessConfig, verifyAccessJwt } from '../services/cloudflare-access'

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
// Pull the presented secret off whichever header this surface accepts.
function presentedSecret(c: Parameters<MiddlewareHandler>[0], bearerOnly: boolean): string {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  const queryKey = ALLOW_API_KEY_QUERY_PARAM.has(c.req.path) ? c.req.query('apikey') : undefined
  const xApiKey = bearerOnly ? undefined : c.req.header('x-api-key')
  return (xApiKey ?? bearer ?? queryKey ?? '').trim()
}

// Does the presented value match the envelope bootstrap token?
function matchesBootstrapToken(provided: string): boolean {
  const expected = (process.env.APIKEY ?? '').trim()
  return expected.length > 0 && provided.length > 0 && timingSafeEqual(digest(provided), digest(expected))
}

export function createApiKeyAuth(options: ApiKeyAuthOptions = {}): MiddlewareHandler {
  const bearerOnly = options.bearerOnly === true
  const errorShape = options.errorShape ?? (bearerOnly ? 'openai' : 'anthropic')
  return async (c, next) => {
    if (!matchesBootstrapToken(presentedSecret(c, bearerOnly))) {
      const err = unauthorizedResponse(errorShape)
      return c.json(err.body, err.status)
    }
    return next()
  }
}

export const apiKeyAuth: MiddlewareHandler = createApiKeyAuth()

/**
 * Gate for /api/* — the admin surface.
 *
 * Cloudflare Access is the intended front door once ACCESS_TEAM_DOMAIN
 * and ACCESS_AUD are set: the edge authenticates a human and forwards a
 * signed assertion, which is verified here against the team JWKS. The
 * header is never trusted on its own, because an origin reachable
 * directly can be handed a forged one.
 *
 * The bootstrap token stays as a second path, deliberately. Access in
 * front of a tunnel is one outage away from locking the operator out of
 * their own admin UI, and Postgres being down must not do the same. It
 * is the recovery path, not the primary one.
 *
 * With Access unconfigured this is exactly the previous behaviour.
 */
export const adminAuth: MiddlewareHandler = async (c, next) => {
  const config = readAccessConfig()
  if (config !== null) {
    const assertion = c.req.header('cf-access-jwt-assertion')
    if (typeof assertion === 'string' && assertion.length > 0) {
      const identity = await verifyAccessJwt(assertion, config)
      if (identity !== null) {
        c.set('accessEmail', identity.email)
        return next()
      }
      // A present-but-invalid assertion is an attempt, not a fallback.
      // Falling through to the bootstrap token here would let anyone who
      // learned the token bypass Access entirely while looking like a
      // verified user.
      const err = unauthorizedResponse('anthropic')
      return c.json(err.body, err.status)
    }
  }

  if (!matchesBootstrapToken(presentedSecret(c, false))) {
    const err = unauthorizedResponse('anthropic')
    return c.json(err.body, err.status)
  }
  return next()
}

/**
 * Gate for /v1/* — the billable proxy.
 *
 * Prefers an issued AccessToken, which is individually revocable and
 * attributable, and can pin the caller to one surface and routing
 * profile. Falls back to the bootstrap token so an existing client
 * keeps working through the migration and so a machine can still reach
 * the proxy when the database is down.
 *
 * The resolved token is stashed on the context for the route to record
 * against the request and to read its routing scope from.
 */
export function createProxyAuth(options: ApiKeyAuthOptions = {}): MiddlewareHandler {
  const bearerOnly = options.bearerOnly === true
  const errorShape = options.errorShape ?? (bearerOnly ? 'openai' : 'anthropic')
  return async (c, next) => {
    const provided = presentedSecret(c, bearerOnly)
    if (provided.length === 0) {
      const err = unauthorizedResponse(errorShape)
      return c.json(err.body, err.status)
    }

    const token = await resolveAccessToken(provided)
    if (token !== null) {
      // A token pinned to one surface must not reach another. Checked
      // here rather than in the route so no handler can forget it.
      if (token.surface !== null && surfaceForPath(c.req.path)?.id !== token.surface) {
        const err = unauthorizedResponse(errorShape)
        return c.json(err.body, err.status)
      }
      c.set('accessToken', token)
      noteTokenUse(token.id)
      return next()
    }

    if (!matchesBootstrapToken(provided)) {
      const err = unauthorizedResponse(errorShape)
      return c.json(err.body, err.status)
    }
    return next()
  }
}

export const proxyAuth: MiddlewareHandler = createProxyAuth()

// OpenAI-compat surface: reject x-api-key (an Anthropic convention) and
// emit an OpenAI-shape error envelope on 401.
export const openaiProxyAuth: MiddlewareHandler = createProxyAuth({ bearerOnly: true })
