/**
 * Web-UI OAuth flow for subscription providers (loopback).
 *
 *   POST /api/oauth/initiate/:provider   (gated by APIKEY)
 *     → { authorizeUrl, state }
 *     UI opens the URL in a NEW TAB. claude.ai's consent page redirects
 *     the browser back to `http://localhost:<port>/callback`, the only
 *     redirect_uri pattern the Claude Code OAuth client allows (per
 *     https://claude.ai/oauth/claude-code-client-metadata — `localhost`
 *     / `127.0.0.1` with any port, path `/callback`).
 *
 *   GET  /callback   (intentionally public, root path)
 *     ← top-level browser redirect from claude.ai with `code` + `state`.
 *     We exchange the code at /v1/oauth/token, write the tokens to the
 *     `.credentials.json` path the CLI uses, trigger syncSubAccountsToDb,
 *     and render a self-closing landing page.
 *
 * Pending flows live in a process-memory map (PoC scope). CSRF
 * protection is the single-use `state` token issued at /initiate;
 * /callback validates against that and rejects unknown / expired
 * states. The path is intentionally outside `/api/*` so the top-level
 * redirect from claude.ai isn't subject to apiKeyAuth.
 */

import { Hono } from 'hono'
import { logger } from '../../logger'
import {
  buildClaudeAuthorizeUrl,
  exchangeClaudeCode,
  writeClaudeCredentialsFromExchange
} from '../../services/claude-oauth-service'
import {
  consumePendingFlow,
  generatePkcePair,
  generateState,
  storePendingFlow
} from '../../services/oauth-flow-service'
import { syncSubAccountsToDb } from '../../services/subscription-account-sync-service'

export const oauthRoute = new Hono()

const SUPPORTED_PROVIDERS = new Set(['claude'])

const isSupportedProvider = (p: string): boolean => SUPPORTED_PROVIDERS.has(p)

oauthRoute.post('/api/oauth/initiate/:provider', (c) => {
  const provider = c.req.param('provider')
  if (!isSupportedProvider(provider)) {
    return c.json({ success: false as const, error: `unsupported provider "${provider}"` }, 400)
  }

  // `localhost` (not `127.0.0.1`) so it matches what `claude login`
  // itself produces — the Anthropic OAuth client allows both per its
  // metadata, but pinning to the same hostname keeps the wire shape
  // identical to the well-tested CLI flow.
  const url = new URL(c.req.url)
  const redirectUri = `http://localhost:${url.port}/callback`

  const state = generateState()
  const { codeVerifier, codeChallenge } = generatePkcePair()
  storePendingFlow(state, { codeVerifier, redirectUri, provider, createdAt: Date.now() })

  const authorizeUrl = buildClaudeAuthorizeUrl({ redirectUri, state, codeChallenge })
  return c.json({ success: true as const, authorizeUrl, state })
})

oauthRoute.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const errorParam = c.req.query('error')

  if (errorParam) {
    return c.html(renderCallbackPage('error', `Upstream returned error: ${errorParam}`), 400)
  }
  if (typeof code !== 'string' || code.length === 0) {
    return c.html(renderCallbackPage('error', 'Missing `code` in callback URL.'), 400)
  }
  if (typeof state !== 'string' || state.length === 0) {
    return c.html(renderCallbackPage('error', 'Missing `state` in callback URL.'), 400)
  }

  const pending = consumePendingFlow(state)
  if (!pending) {
    return c.html(renderCallbackPage('error', 'Unknown or expired `state`. Start the flow again.'), 400)
  }
  const provider = pending.provider

  try {
    const tokens = await exchangeClaudeCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
      state
    })
    await writeClaudeCredentialsFromExchange(tokens)
    await syncSubAccountsToDb()
    return c.html(renderCallbackPage('ok', 'You can close this tab and return to the Claude Code Router UI.'))
  } catch (err) {
    logger.error({ err, provider }, '[oauth] callback failed')
    const message = err instanceof Error ? err.message : 'Unknown error during token exchange.'
    return c.html(renderCallbackPage('error', message), 500)
  }
})

// Minimal self-closing landing page so the user has something to look
// at after the IdP redirects them back. Kept inline — single page,
// single purpose, no template engine needed.
const renderCallbackPage = (status: 'ok' | 'error', message: string): string => {
  const title = status === 'ok' ? 'Sign-in complete' : 'Sign-in failed'
  const color = status === 'ok' ? '#0a7' : '#c33'
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} — Claude Code Router</title>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #222; }
    h1 { color: ${color}; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
