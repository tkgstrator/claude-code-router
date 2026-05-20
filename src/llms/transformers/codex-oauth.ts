/**
 * Codex (ChatGPT subscription) OAuth transformer.
 *
 * Unlike claude-code (Anthropic in, Anthropic out — a passthrough that
 * only needs an auth header), codex talks the OpenAI Responses API to
 * the ChatGPT backend. So it runs the full transform chain (anthropic
 * endpoint transformer -> openai-responses) and this transformer sits
 * LAST in the provider's `use` list: openai-responses has already
 * reshaped the body to Responses format, and we add the subscription
 * auth + the chatgpt.com/backend-api/codex requirements.
 */

import { createHash, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { arch, homedir } from 'os'
import { join } from 'path'
import type { RuntimeProvider, TransformerContext, TransformerHookResult, UnifiedChatRequest } from '../types'
import { OAuthTransformer, type OauthCredentials } from './oauth-base'

// Identify as the official Codex CLI. The ChatGPT backend classifies a
// request as "CLI" (subscription allotment) vs "Other" (overage) by
// these markers; without them codex requests bill as Other and skip the
// CLI path. Version source order: CODEX_CLI_VERSION env (lets prod pin
// it if @openai/codex is ever pruned) -> the installed @openai/codex
// package -> "0.0.0". Resolved once at boot; never throws.
const CODEX_USER_AGENT: string = (() => {
  const safe = (fn: () => string, fallback: string): string => {
    try {
      const v = fn().trim()
      return v.length > 0 ? v : fallback
    } catch {
      return fallback
    }
  }
  const codexVer =
    (process.env.CODEX_CLI_VERSION ?? '').trim() ||
    safe(() => {
      const pkg = createRequire(import.meta.url)('@openai/codex/package.json') as { version: string }
      return pkg.version
    }, '0.0.0')
  const osStr = safe(() => {
    const rel = readFileSync('/etc/os-release', 'utf-8')
    const name = rel.match(/^NAME="?([^"\n]+)"?/m)?.[1] ?? 'Linux'
    const ver = rel.match(/^VERSION_ID="?([^"\n]+)"?/m)?.[1] ?? ''
    return `${name} ${ver}`.trim()
  }, 'Linux')
  return `codex_cli/${codexVer} (${osStr}; ${arch()})`
})()

const DEFAULT_CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json')

interface CodexAuthFile {
  tokens?: {
    access_token?: string
    account_id?: string
  }
}

function readCodexAuth(codexAuthPath: string): OauthCredentials {
  let data: CodexAuthFile
  try {
    data = JSON.parse(readFileSync(codexAuthPath, 'utf-8')) as CodexAuthFile
  } catch {
    throw new Error(`Cannot read Codex credentials from ${codexAuthPath}. ` + 'Authenticate the Codex CLI first.')
  }
  const token = data.tokens?.access_token
  if (!token) {
    throw new Error('Codex credentials are missing tokens.access_token')
  }
  return { token, accountId: data.tokens?.account_id }
}

interface CodexRequestShape extends UnifiedChatRequest {
  store?: boolean
  instructions?: string
  prompt_cache_key?: string
  input?: unknown
}

export class CodexOauthTransformer extends OAuthTransformer {
  readonly name = 'codex-oauth'
  protected readonly defaultCredentialPath = DEFAULT_CODEX_AUTH_PATH

  protected async readFromDisk(path: string): Promise<OauthCredentials> {
    return readCodexAuth(path)
  }

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<TransformerHookResult> {
    const { token, accountId } = await this.resolveSubscriptionAuth(provider)
    const req = request as CodexRequestShape

    // chatgpt.com/backend-api/codex requires `instructions`, `input` as
    // a list, store=false and stream=true. openai-responses already
    // produced `input` and lifts `instructions` from the system block;
    // enforce the rest (and a non-empty instructions fallback).
    req.store = false
    req.stream = true
    if (typeof req.instructions !== 'string' || req.instructions.length === 0) {
      req.instructions = 'You are a helpful assistant.'
    }

    // OpenAI routes its prompt cache by `prompt_cache_key`; the official
    // CLI uses a per-session uuid. This proxy is stateless, so derive a
    // deterministic key from the stable request prefix instead — every
    // turn of the same conversation hashes identically and hits the
    // cache, fixing the prefix being re-billed each turn.
    req.prompt_cache_key = createHash('sha256')
      .update(`${req.model ?? ''}\n${req.instructions ?? ''}\n${JSON.stringify(req.tools ?? [])}`)
      .digest('hex')
      .slice(0, 32)

    // provider.api_base_url is the codex backend root
    // (https://chatgpt.com/backend-api/codex); the Responses endpoint
    // is one level down. sendRequestToProvider uses config.url verbatim
    // when set, otherwise provider.api_base_url.
    const base = String(provider.api_base_url ?? '').replace(/\/+$/, '')
    const url = /\/responses$/.test(base) ? base : `${base}/responses`

    const sessionId = randomUUID()

    return {
      body: req,
      config: {
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          originator: 'codex_cli',
          'user-agent': CODEX_USER_AGENT,
          session_id: sessionId,
          thread_id: sessionId,
          'x-client-request-id': randomUUID(),
          'x-codex-beta-features': 'terminal_resize_reflow',
          'x-codex-window-id': `${sessionId}:0`,
          ...(accountId ? { 'chatgpt-account-id': accountId } : {})
        }
      }
    }
  }

  // Response chain runs reversed, so this fires BEFORE openai-responses.
  // The ChatGPT codex backend streams a Responses-API SSE body but does
  // NOT send `Content-Type: text/event-stream`. openai-responses (and
  // then the anthropic endpoint transformer) branch on Content-Type and
  // otherwise JSON.parse the body — which throws on "event: response…".
  // Re-tag a successful stream so the SSE branch is taken. Non-2xx
  // bodies are genuine JSON errors; leave them untouched.
  async transformResponseOut(response: Response, _context: TransformerContext): Promise<Response> {
    if (!response.ok) return response
    const ct = response.headers.get('content-type') || ''
    if (ct.includes('text/event-stream')) return response
    const headers = new Headers(response.headers)
    headers.set('content-type', 'text/event-stream')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  }
}
