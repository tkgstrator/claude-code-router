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

import type { Context } from 'hono'
import { Hono } from 'hono'
import { logger } from '../../logger'
import {
  buildClaudeAuthorizeUrl,
  exchangeClaudeCode,
  writeClaudeCredentialsFromExchange
} from '../../services/claude-oauth-service'
import {
  buildCodexAuthorizeUrl,
  CODEX_CALLBACK_PATH,
  exchangeCodexCode,
  writeCodexCredentialsFromExchange
} from '../../services/codex-oauth-service'
import {
  consumePendingFlow,
  generatePkcePair,
  generateState,
  storePendingFlow
} from '../../services/oauth-flow-service'
import { syncSubAccountsToDb } from '../../services/subscription-account-sync-service'

export const oauthRoute = new Hono()

const CLAUDE_CALLBACK_PATH = '/callback'

const PROVIDER_CALLBACK_PATH: Record<string, string> = {
  claude: CLAUDE_CALLBACK_PATH,
  codex: CODEX_CALLBACK_PATH
}

const isSupportedProvider = (p: string): p is 'claude' | 'codex' => p === 'claude' || p === 'codex'

oauthRoute.post('/api/oauth/initiate/:provider', (c) => {
  const provider = c.req.param('provider')
  if (!isSupportedProvider(provider)) {
    return c.json({ success: false as const, error: `unsupported provider "${provider}"` }, 400)
  }

  const url = new URL(c.req.url)
  const callbackPath = PROVIDER_CALLBACK_PATH[provider]
  // `localhost` (not `127.0.0.1`) to match the CLI flows verbatim —
  // both upstream OAuth clients allow the same hostname.
  const redirectUri = `http://localhost:${url.port}${callbackPath}`

  const state = generateState()
  const { codeVerifier, codeChallenge } = generatePkcePair()
  storePendingFlow(state, { codeVerifier, redirectUri, provider, createdAt: Date.now() })

  const authorizeUrl =
    provider === 'claude'
      ? buildClaudeAuthorizeUrl({ redirectUri, state, codeChallenge })
      : buildCodexAuthorizeUrl({ redirectUri, state, codeChallenge })

  return c.json({ success: true as const, authorizeUrl, state })
})

const handleCallback = async (c: Context, expectedProvider: 'claude' | 'codex') => {
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
  if (pending.provider !== expectedProvider) {
    return c.html(
      renderCallbackPage('error', `State belongs to provider "${pending.provider}", not "${expectedProvider}".`),
      400
    )
  }

  try {
    if (expectedProvider === 'claude') {
      const tokens = await exchangeClaudeCode({
        code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
        state
      })
      await writeClaudeCredentialsFromExchange(tokens)
    } else {
      const tokens = await exchangeCodexCode({
        code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri
      })
      await writeCodexCredentialsFromExchange(tokens)
    }
    await syncSubAccountsToDb()
    return c.html(renderCallbackPage('ok', 'You can close this tab and return to the Claude Code Router UI.'))
  } catch (err) {
    logger.error({ err, provider: expectedProvider }, '[oauth] callback failed')
    const message = err instanceof Error ? err.message : 'Unknown error during token exchange.'
    return c.html(renderCallbackPage('error', message), 500)
  }
}

oauthRoute.get(CLAUDE_CALLBACK_PATH, (c) => handleCallback(c, 'claude'))
oauthRoute.get(CODEX_CALLBACK_PATH, (c) => handleCallback(c, 'codex'))

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
