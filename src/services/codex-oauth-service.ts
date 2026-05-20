/**
 * OpenAI / ChatGPT OAuth code-grant for the Codex provider.
 *
 * Mirrors what `codex login` does on a fresh device — same authorize
 * host (auth.openai.com), same client_id, same custom params
 * (`id_token_add_organizations`, `codex_cli_simplified_flow`,
 * `originator=codex_cli_rs`) — and writes the resulting tokens to the
 * `~/.codex/auth.json` array shape the existing
 * subscription-account-sync-service reader expects (entry shape:
 * `{ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {...},
 * last_refresh: ISO-string }`).
 *
 * The account_id is pulled from the id_token's
 * `https://api.openai.com/auth.chatgpt_account_id` claim — same shape
 * the existing readCodexAccounts in subscription-account-sync-service
 * already decodes.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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
  // `id_token_add_organizations=true` opts the id_token into carrying
  // the `organizations[]` claim under https://api.openai.com/auth,
  // which the existing JWT decoder reads for the org list.
  // `codex_cli_simplified_flow=true` swaps the consent UX for the
  // single-click "Continue as <user>" page the CLI uses.
  // `originator=codex_cli_rs` is the originator string codex CLI sends.
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
    originator: 'codex_cli_rs'
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

const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  try {
    const padded = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), '=')
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

// Pull `chatgpt_account_id` out of the id_token's
// https://api.openai.com/auth claim block.
const extractAccountId = (idToken: string): string | null => {
  const claims = decodeJwtPayload(idToken)
  if (!claims) return null
  const auth = claims['https://api.openai.com/auth']
  if (typeof auth !== 'object' || auth === null) return null
  const v = (auth as Record<string, unknown>).chatgpt_account_id
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Write the token response to `~/.codex/auth.json` (or wherever
 * CCR_CODEX_AUTH_DIR points) in the array-of-entries shape the codex
 * CLI itself uses, so the existing readCodexAccounts sync path picks
 * the new account up without code changes.
 */
export const writeCodexCredentialsFromExchange = async (
  tokens: CodexTokenExchangeResponse,
  authPath: string = defaultCodexAuthPath()
): Promise<void> => {
  const accountId = extractAccountId(tokens.id_token) ?? ''
  const entry = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      account_id: accountId
    },
    last_refresh: new Date().toISOString()
  }
  await mkdir(dirname(authPath), { recursive: true })
  await writeFile(authPath, `${JSON.stringify([entry], null, 2)}\n`)
}

export const defaultCodexAuthPath = (): string => {
  const dirEnv = process.env.CCR_CODEX_AUTH_DIR
  const dir = typeof dirEnv === 'string' ? dirEnv.trim() : ''
  return dir.length > 0 ? join(dir, 'auth.json') : join(homedir(), '.codex', 'auth.json')
}
