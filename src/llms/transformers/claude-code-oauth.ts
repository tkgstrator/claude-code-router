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

import { HTTPException } from 'hono/http-exception'
import { OauthRefreshResponseSchema, type RuntimeProvider, type TransformerContext } from '@/schemas'
import type { TransformerAuthResult } from './base'
import { type OAuthRefreshResult, OAuthTransformer } from './oauth-base'

const REFRESH_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

// A Claude subscription OAuth token only gets the subscription's model
// allotment (incl. premium models like Opus/Sonnet) when the request is
// identified as official Claude Code. Without this, premium models are
// routed to the API "overage" path instead — which is org-disabled on
// subscriptions — and 429 with rate_limit_error while Haiku (served from
// the base allotment) still 200s.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

type AnthropicSystemBlock = {
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
function toSystemBlock(value: unknown): AnthropicSystemBlock {
  if (typeof value === 'string') return { type: 'text', text: value }
  if (value === null || typeof value !== 'object') return {}
  const type = Reflect.get(value, 'type')
  const text = Reflect.get(value, 'text')
  const cache_control = Reflect.get(value, 'cache_control')
  return {
    type: typeof type === 'string' ? type : undefined,
    text: typeof text === 'string' ? text : undefined,
    cache_control
  }
}

export function withClaudeCodeIdentity(system: unknown): AnthropicSystemBlock[] {
  let blocks: AnthropicSystemBlock[]
  if (typeof system === 'string') {
    blocks = system.length > 0 ? [{ type: 'text', text: system }] : []
  } else if (Array.isArray(system)) {
    blocks = system.map(toSystemBlock)
  } else {
    blocks = []
  }
  // Claude Code (≥2.1.146) places a billing-header block at [0] and the
  // identity at [1], so checking only blocks[0] missed the identity and
  // prepended a duplicate — breaking the prompt-cache prefix every turn.
  const hasIdentity = blocks.some((b) => typeof b.text === 'string' && b.text.startsWith(CLAUDE_CODE_IDENTITY))
  if (hasIdentity) return blocks
  return [{ type: 'text', text: CLAUDE_CODE_IDENTITY }, ...blocks]
}

type ClaudeCodeRequestShape = {
  system?: unknown
  messages?: Array<{ content?: unknown; [k: string]: unknown }>
  thinking?: unknown
  [k: string]: unknown
}

function keepSignedBlock(block: unknown): boolean {
  if (block === null || typeof block !== 'object') return true
  const type = Reflect.get(block, 'type')
  if (type !== 'thinking') return true
  const signature = Reflect.get(block, 'signature')
  return typeof signature === 'string' && signature.length > 0
}

// Strip an inbound top-level `thinking` block unless the caller opted
// into extended thinking. Recent Claude Code builds send
// `thinking: { type: "disabled" }` to explicitly turn thinking off, but
// Anthropic rejects any type other than `enabled` with a 400
// ("thinking.type.disabled is not supported for this model. Thinking
// defaults to adaptive mode when not specified"). Omitting the field
// entirely gives the same behaviour the client intended (no extended
// thinking), so drop everything except an explicit `enabled` request.
// Exported for unit testing.
export function stripDisabledThinking(req: { thinking?: unknown }): void {
  if (typeof req.thinking !== 'object' || req.thinking === null) return
  const thinkingType = Reflect.get(req.thinking, 'type')
  if (thinkingType !== 'enabled') delete req.thinking
}

export class ClaudeCodeOauthTransformer extends OAuthTransformer {
  readonly name = 'claude-code-oauth'
  readonly endPoint = '/v1/messages'

  protected async refresh(input: { refreshToken: string }): Promise<OAuthRefreshResult | null> {
    const response = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: CLIENT_ID
      })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      // biome-ignore plugin: Hono's HTTPException status is a closed union of supported HTTP codes; arbitrary upstream codes must be widened.
      throw new HTTPException(response.status as never, {
        message: `Token refresh failed: ${response.status} ${detail}`.trim()
      })
    }
    const result = OauthRefreshResponseSchema.safeParse(await response.json())
    if (!result.success) {
      throw new HTTPException(502, { message: `Invalid OAuth refresh response: ${result.error.message}` })
    }
    const expiresInSec = result.data.expires_in !== undefined ? result.data.expires_in : 3600
    return {
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token,
      expiresAt: new Date(Date.now() + expiresInSec * 1000)
    }
  }

  async auth(request: unknown, provider: RuntimeProvider, context: TransformerContext): Promise<TransformerAuthResult> {
    const sessionId = (context?.req?.headers?.['x-claude-code-session-id'] as string | undefined) ?? undefined
    const { token } = await this.resolveSubscriptionAuth(provider, sessionId, 'claude')
    // biome-ignore plugin: the OAuth auth hook receives the inbound Anthropic body verbatim (unknown by design); narrowing to a Zod schema would re-encode the whole request, defeating the bypass-mode passthrough.
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
        const filtered = msg.content.filter((block) => keepSignedBlock(block))
        return { ...msg, content: filtered }
      })
    }

    stripDisabledThinking(req)

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
    // biome-ignore plugin: bypass-mode passthrough — the request is already in the upstream wire shape; the abstract base's signature returns UnifiedChatRequest but here we return whatever came in.
    return request as never
  }

  async transformResponseIn(response: Response, _context?: TransformerContext): Promise<Response> {
    return response
  }
}
