/**
 * OpenAI / ChatGPT OAuth code-grant for the Codex provider.
 *
 * Mirrors what `codex login` does on a fresh device — same authorize
 * host (auth.openai.com), same client_id, same custom params
 * (`id_token_add_organizations`, `codex_cli_simplified_flow`,
 * `originator=codex-tui`). Persistence is handled by
 * subscription-account-sync-service.recordCodexOAuthAccount — tokens
 * land encrypted in the DB; nothing is written to disk.
 */

import { logger } from '../logger'

const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

// Captured verbatim from `codex login` against a fresh CODEX_HOME.
const CODEX_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'api.connectors.read', 'api.connectors.invoke']

// `codex login` always binds its loopback server to /auth/callback —
// the OAuth client only allows that path. The port is wildcarded so we
// can reuse the CCR server's port instead of spinning a second listener.
export const CODEX_CALLBACK_PATH = '/auth/callback'

const DEBUG_OAUTH = process.env.CCR_DEBUG_OAUTH === '1'

export const buildCodexAuthorizeUrl = (opts: { redirectUri: string; state: string; codeChallenge: string }): string => {
  // Param set captured verbatim from a fresh `codex login` run.
  // - id_token_add_organizations=true: id_token carries the
  //   `organizations[]` claim under https://api.openai.com/auth, which
  //   the existing JWT decoder reads for the org list.
  // - codex_cli_simplified_flow=true: required — without it the consent
  //   page hands back `error_code: unknown_error`.
  // - originator=codex-tui: required for the same reason; identifies
  //   the request as coming from the codex TUI flow.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: opts.redirectUri,
    scope: CODEX_SCOPES.join(' '),
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state: opts.state,
    originator: 'codex-tui'
  })
  return `${CODEX_AUTHORIZE_URL}?${params}`
}

interface CodexTokenExchangeResponse {
  access_token: string
  id_token: string
  refresh_token: string
  expires_in?: number
}

const isCodexTokenResponse = (value: unknown): value is CodexTokenExchangeResponse => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.access_token === 'string' &&
    v.access_token.length > 0 &&
    typeof v.id_token === 'string' &&
    v.id_token.length > 0 &&
    typeof v.refresh_token === 'string' &&
    v.refresh_token.length > 0
  )
}

// refresh_token grants return the same shape as an authorization_code
// exchange, but the id_token may be omitted when nothing about the
// user's session changed — accept the response as long as access_token
// and refresh_token are non-empty.
export interface CodexRefreshResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  expires_in?: number
}

const isCodexRefreshResponse = (value: unknown): value is CodexRefreshResponse => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.access_token === 'string' &&
    v.access_token.length > 0 &&
    typeof v.refresh_token === 'string' &&
    v.refresh_token.length > 0
  )
}

export const exchangeCodexCode = async (opts: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<CodexTokenExchangeResponse> => {
  // OpenAI's token endpoint follows RFC 6749 §4.1.3 verbatim —
  // form-urlencoded body, no Anthropic-style state echo. redirect_uri
  // must be byte-identical to what authorize used.
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: CODEX_CLIENT_ID,
    code_verifier: opts.codeVerifier
  })
  const res = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (DEBUG_OAUTH) {
      logger.error(
        { status: res.status, requestBody: form.toString(), responseBody: body },
        '[codex-oauth] token exchange failed'
      )
    } else {
      logger.error({ status: res.status, responseBody: body }, '[codex-oauth] token exchange failed')
    }
    throw new Error(`codex token exchange failed: ${res.status} ${body}`.trim())
  }
  const raw = await res.json()
  if (!isCodexTokenResponse(raw)) {
    throw new Error('codex token exchange returned an unexpected payload')
  }
  return raw
}

// Rotate a codex access_token using a stored refresh_token. Mirrors the
// authorization_code exchange but with grant_type=refresh_token and no
// PKCE / redirect params — the request set is the RFC 6749 §6 minimum
// plus OpenAI's required client_id. Scope is intentionally omitted so
// the token server keeps the original grant's scope set (including
// offline_access, which is what allows this refresh in the first place).
export const refreshCodexToken = async (opts: { refreshToken: string }): Promise<CodexRefreshResponse> => {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: CODEX_CLIENT_ID
  })
  const res = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (DEBUG_OAUTH) {
      logger.error(
        { status: res.status, requestBody: form.toString(), responseBody: body },
        '[codex-oauth] token refresh failed'
      )
    } else {
      logger.error({ status: res.status, responseBody: body }, '[codex-oauth] token refresh failed')
    }
    throw new Error(`codex token refresh failed: ${res.status} ${body}`.trim())
  }
  const raw = await res.json()
  if (!isCodexRefreshResponse(raw)) {
    throw new Error('codex token refresh returned an unexpected payload')
  }
  return raw
}
