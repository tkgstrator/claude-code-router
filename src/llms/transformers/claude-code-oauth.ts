/**
 * Claude Code subscription OAuth transformer.
 *
 * Identifies the request as the official Claude Code client by attaching:
 *   1. an OAuth bearer (not x-api-key)
 *   2. the Claude Code identity string as the first system block
 *
 * The anthropic-beta `oauth-2025-04-20` header is added by the /v1
 * adapter on the subscription path so other client betas are preserved
 * verbatim.
 */

import { readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { logger } from '../../logger'
import type { RuntimeProvider, TransformerContext } from '../types'
import type { TransformerAuthResult } from './base'
import { OAuthTransformer, type OauthCredentials } from './oauth-base'

const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json')

const REFRESH_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scopes: string[]
    subscriptionType?: string
    rateLimitTier?: string
  }
  organizationUuid?: string
}

interface RefreshResponse {
  access_token: string
  expires_in?: number
  refresh_token?: string
}

function readCredentials(credentialsPath: string): ClaudeCredentials {
  try {
    return JSON.parse(readFileSync(credentialsPath, 'utf-8')) as ClaudeCredentials
  } catch {
    throw new Error(
      `Cannot read Claude Code credentials from ${credentialsPath}. ` + 'Please authenticate Claude Code first.'
    )
  }
}

async function refreshToken(refreshTokenValue: string, credentialsPath: string): Promise<string> {
  const response = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue,
      client_id: CLIENT_ID
    })
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Token refresh failed: ${response.status} ${detail}`.trim())
  }

  const data = (await response.json()) as RefreshResponse
  const credentials = readCredentials(credentialsPath)
  credentials.claudeAiOauth.accessToken = data.access_token
  credentials.claudeAiOauth.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000
  if (data.refresh_token) {
    credentials.claudeAiOauth.refreshToken = data.refresh_token
  }
  writeFileSync(credentialsPath, JSON.stringify(credentials))
  return data.access_token
}

// Shared in-flight refresh. Without this, Claude Code firing the main
// model (e.g. Opus) and a background/subagent call (e.g. Sonnet)
// near-simultaneously makes BOTH requests read the about-to-expire
// token and each POST a refresh with the SAME refresh token. The OAuth
// refresh token is single-use/rotating, so only the first call succeeds;
// the loser gets invalid_grant, falls back to the now-stale access token
// and 401s upstream. Collapsing concurrent refreshes into one promise
// means every waiter gets the same fresh token (or the same consistent
// fallback).
const refreshInFlightByPath = new Map<string, Promise<string>>()

async function getValidToken(credentialsPath: string): Promise<string> {
  const credentials = readCredentials(credentialsPath)
  const { accessToken, refreshToken: rt, expiresAt } = credentials.claudeAiOauth

  if (expiresAt - Date.now() >= 5 * 60 * 1000) {
    return accessToken
  }

  if (!refreshInFlightByPath.has(credentialsPath)) {
    const inFlight = refreshToken(rt, credentialsPath)
      .catch((e: unknown) => {
        logger.error(
          {
            provider: 'claude-code',
            err: String((e as Error)?.message ?? e)
          },
          '[claude-code-oauth] OAuth token refresh failed; using ' +
            'the existing token (likely to 401). Re-authenticate: run ' +
            '`claude` and sign in, which rewrites ' +
            '~/.claude/.credentials.json (no `ccr restart` needed — the ' +
            'file is re-read every request).'
        )
        return accessToken
      })
      .finally(() => {
        refreshInFlightByPath.delete(credentialsPath)
      })
    refreshInFlightByPath.set(credentialsPath, inFlight)
  }

  return refreshInFlightByPath.get(credentialsPath)!
}

// A Claude subscription OAuth token only gets the subscription's model
// allotment (incl. premium models like Opus/Sonnet) when the request is
// identified as official Claude Code. Without this, premium models are
// routed to the API "overage" path instead — which is org-disabled on
// subscriptions — and 429 with rate_limit_error while Haiku (served from
// the base allotment) still 200s.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

interface AnthropicSystemBlock {
  type?: string
  text?: string
  cache_control?: unknown
}

// Anthropic system is a string or an array of text blocks. Normalise to
// an array and guarantee the first block is the Claude Code identity,
// without duplicating it if the caller already sent it. Blocks are kept
// verbatim (only bare strings are wrapped) so any cache_control Claude
// Code attached survives — Anthropic prompt caching is prefix-based, and
// rebuilding blocks as plain {type,text} dropped the cache breakpoints,
// re-billing the whole system/tools prefix as fresh input every turn.
function withClaudeCodeIdentity(system: unknown): AnthropicSystemBlock[] {
  const blocks: AnthropicSystemBlock[] =
    typeof system === 'string'
      ? system.length > 0
        ? [{ type: 'text', text: system }]
        : []
      : Array.isArray(system)
        ? (system as unknown[]).map((b) =>
            typeof b === 'string' ? { type: 'text', text: b } : (b as AnthropicSystemBlock)
          )
        : []
  const firstText = typeof blocks[0]?.text === 'string' ? blocks[0].text : ''
  if (firstText.startsWith(CLAUDE_CODE_IDENTITY)) return blocks
  return [{ type: 'text', text: CLAUDE_CODE_IDENTITY }, ...blocks]
}

interface ClaudeCodeRequestShape {
  system?: unknown
  messages?: Array<{ content?: unknown; [k: string]: unknown }>
  [k: string]: unknown
}

export class ClaudeCodeOauthTransformer extends OAuthTransformer {
  readonly name = 'claude-code-oauth'
  readonly endPoint = '/v1/messages'
  protected readonly defaultCredentialPath = DEFAULT_CREDENTIALS_PATH

  protected async readFromDisk(path: string): Promise<OauthCredentials> {
    // getValidToken handles both the read and any near-expiry refresh,
    // returning a usable access token. No accountId for Claude.
    return { token: await getValidToken(path) }
  }

  async auth(
    request: unknown,
    provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<TransformerAuthResult> {
    const { token } = await this.resolveSubscriptionAuth(provider)
    const req = request as ClaudeCodeRequestShape
    req.system = withClaudeCodeIdentity(req.system)

    // Remove thinking blocks that lack a valid Anthropic signature. When
    // conversation turns are routed to different providers, thinking
    // blocks generated by another provider have no signature (or a fake
    // one) that Anthropic cannot validate, causing a 400 "Invalid
    // `signature` in `thinking` block". Blocks that originated from
    // Anthropic carry a non-empty `signature` field and must be preserved
    // — stripping them invalidates the prompt-cache prefix and re-bills
    // the full context. redacted_thinking blocks are Anthropic-native
    // and are always kept.
    if (Array.isArray(req.messages)) {
      req.messages = req.messages.map((msg) => {
        if (!Array.isArray(msg.content)) return msg
        const filtered = (msg.content as Array<{ type?: string; signature?: unknown }>).filter(
          (block) => block.type !== 'thinking' || (typeof block.signature === 'string' && block.signature.length > 0)
        )
        return { ...msg, content: filtered }
      })
    }

    return {
      body: req,
      config: {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          'x-api-key': undefined
        }
      }
    }
  }

  // Passthrough — request is already in Anthropic format
  async transformRequestOut(request: unknown, _context: TransformerContext): Promise<never> {
    return request as never
  }

  async transformResponseIn(response: Response, _context?: TransformerContext): Promise<Response> {
    return response
  }
}
