/**
 * Web-UI OAuth flow for subscription providers (loopback).
 *
 *   POST /api/oauth/initiate/:provider   (gated by APIKEY)
 *     → { authorizeUrl, state }
 *     UI opens the URL in a NEW TAB. claude / codex's consent page
 *     redirects the browser back to the loopback callback the
 *     upstream OAuth client whitelists:
 *       - claude → http://localhost:<port>/callback
 *       - codex  → http://localhost:<port>/auth/callback
 *
 *   GET  /callback        (claude — intentionally public, root path)
 *   GET  /auth/callback   (codex  — intentionally public, root path)
 *     ← top-level browser redirect with `code` + `state`. We look up
 *     the pending flow by state, dispatch to the provider-specific
 *     token exchange + credentials writer, then trigger the
 *     SubAccount sync.
 *
 * Pending flows live in a process-memory map (PoC scope). CSRF
 * protection is the single-use `state` token issued at /initiate;
 * /callback validates against that and rejects unknown / expired
 * states. The callback paths are intentionally outside `/api/*` so
 * the top-level redirect from the IdP isn't subject to apiKeyAuth.
 */

import { Hono } from 'hono'
import { logger } from '../../logger'
import { buildClaudeAuthorizeUrl, CLAUDE_SCOPES, exchangeClaudeCode } from '../../services/claude-oauth-service'
import { CODEX_CALLBACK_PORT, ensureCodexCallbackListener } from '../../services/codex-callback-listener'
import { buildCodexAuthorizeUrl, CODEX_CALLBACK_PATH } from '../../services/codex-oauth-service'
import {
  consumePendingFlow,
  generatePkcePair,
  generateState,
  storePendingFlow
} from '../../services/oauth-flow-service'
import { recordClaudeOAuthAccount } from '../../services/subscription-account-sync-service'

export const oauthRoute = new Hono()

const CLAUDE_CALLBACK_PATH = '/callback'

const PROVIDER_CALLBACK_PATH: Record<string, string> = {
  claude: CLAUDE_CALLBACK_PATH,
  codex: CODEX_CALLBACK_PATH
}

const isSupportedProvider = (p: string): p is 'claude' | 'codex' => p === 'claude' || p === 'codex'

oauthRoute.post('/api/oauth/initiate/:provider', async (c) => {
  const provider = c.req.param('provider')
  if (!isSupportedProvider(provider)) {
    return c.json({ success: false as const, error: `unsupported provider "${provider}"` }, 400)
  }

  const callbackPath = PROVIDER_CALLBACK_PATH[provider]
  const initiateUrl = new URL(c.req.url)
  const ccrBaseUrl = `${initiateUrl.protocol}//${initiateUrl.host}`
  let redirectUri: string
  if (provider === 'codex') {
    // OpenAI's OAuth client only allows http://localhost:1455/auth/callback —
    // confirmed: any other loopback port returns unknown_error.
    try {
      await ensureCodexCallbackListener({ resultBaseUrl: ccrBaseUrl })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to bind codex callback listener on :1455'
      return c.json({ success: false as const, error: message }, 500)
    }
    redirectUri = `http://localhost:${CODEX_CALLBACK_PORT}${callbackPath}`
  } else {
    redirectUri = `http://localhost:${initiateUrl.port}${callbackPath}`
  }

  const state = generateState()
  const { codeVerifier, codeChallenge } = generatePkcePair()
  storePendingFlow(state, { codeVerifier, redirectUri, provider, createdAt: Date.now() })

  const authorizeUrl =
    provider === 'claude'
      ? buildClaudeAuthorizeUrl({ redirectUri, state, codeChallenge })
      : buildCodexAuthorizeUrl({ redirectUri, state, codeChallenge })

  return c.json({ success: true as const, authorizeUrl, state })
})

// claude only — codex's callback is served by the standalone listener on
// port 1455 (see codex-callback-listener.ts) because its OAuth client
// doesn't allow any other loopback port.
oauthRoute.get(CLAUDE_CALLBACK_PATH, async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const errorParam = c.req.query('error')

  const url = new URL(c.req.url)
  const baseUrl = `${url.protocol}//${url.host}`
  const resultUrl = (status: 'ok' | 'error', message?: string): string => {
    const p = new URLSearchParams({ status, provider: 'claude' })
    if (message) p.set('message', message)
    return `${baseUrl}/oauth-result?${p.toString()}`
  }

  if (errorParam) return c.redirect(resultUrl('error', `Upstream returned error: ${errorParam}`))
  if (typeof code !== 'string' || code.length === 0)
    return c.redirect(resultUrl('error', 'Missing `code` in callback URL.'))
  if (typeof state !== 'string' || state.length === 0)
    return c.redirect(resultUrl('error', 'Missing `state` in callback URL.'))

  const pending = consumePendingFlow(state)
  if (!pending) return c.redirect(resultUrl('error', 'Unknown or expired `state`. Start the flow again.'))
  if (pending.provider !== 'claude')
    return c.redirect(resultUrl('error', `State belongs to provider "${pending.provider}", not "claude".`))

  try {
    const tokens = await exchangeClaudeCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
      state
    })
    await recordClaudeOAuthAccount({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scopes: CLAUDE_SCOPES
    })
    return c.redirect(resultUrl('ok'))
  } catch (err) {
    logger.error({ err, provider: 'claude' }, '[oauth] callback failed')
    const message = err instanceof Error ? err.message : 'Unknown error during token exchange.'
    return c.redirect(resultUrl('error', message))
  }
})
