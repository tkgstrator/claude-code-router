/**
 * Unit tests for withClaudeCodeIdentity — the system-block normaliser
 * inside ClaudeCodeOauthTransformer.
 *
 * The function must guarantee:
 *  1. The Claude Code identity string is present in the outgoing system.
 *  2. When the identity is already present (at ANY position), the blocks are
 *     returned as-is — no duplicate is prepended and the cache_control
 *     breakpoints are not shifted.
 *  3. When the identity is absent, it is prepended at [0] without
 *     cache_control so the subscription-routing requirement is met.
 */

import { describe, expect, test } from 'bun:test'
import { stripDisabledThinking, withClaudeCodeIdentity } from '../../../src/llms/transformers/claude-code-oauth'

const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

// ─── helpers ────────────────────────────────────────────────────────────────

const billingBlock = {
  type: 'text',
  text: 'x-anthropic-billing-header: cc_version=2.1.146.793; cc_entrypoint=cli; cch=50a72;',
}

const identityBlock = { type: 'text', text: IDENTITY }

const mainBlock = {
  type: 'text',
  text: 'You are an interactive agent…',
  cache_control: { type: 'ephemeral', ttl: '1h', scope: 'global' },
}

const additionalBlock = {
  type: 'text',
  text: '# Text output…',
  cache_control: { type: 'ephemeral', ttl: '1h' },
}

// ─── Claude Code ≥2.1.146 format (billing at [0], identity at [1]) ─────────

describe('Claude Code ≥2.1.146 format — billing header at [0], identity at [1]', () => {
  const system = [billingBlock, identityBlock, mainBlock, additionalBlock]

  test('does not prepend a duplicate identity block', () => {
    const result = withClaudeCodeIdentity(system)
    const identityBlocks = result.filter((b) => b.text?.startsWith(IDENTITY))
    expect(identityBlocks).toHaveLength(1)
  })

  test('returns the same number of blocks as the input', () => {
    const result = withClaudeCodeIdentity(system)
    expect(result).toHaveLength(system.length)
  })

  test('preserves cache_control on all blocks', () => {
    const result = withClaudeCodeIdentity(system)
    expect(result[2].cache_control).toEqual(mainBlock.cache_control)
    expect(result[3].cache_control).toEqual(additionalBlock.cache_control)
  })

  test('billing header remains at [0]', () => {
    const result = withClaudeCodeIdentity(system)
    expect(result[0].text).toBe(billingBlock.text)
  })

  test('identity remains at [1]', () => {
    const result = withClaudeCodeIdentity(system)
    expect(result[1].text).toBe(IDENTITY)
  })
})

// ─── Older Claude Code format (identity at [0], no billing header) ──────────

describe('older Claude Code format — identity at [0]', () => {
  const system = [identityBlock, mainBlock, additionalBlock]

  test('does not prepend a duplicate identity block', () => {
    const result = withClaudeCodeIdentity(system)
    const identityBlocks = result.filter((b) => b.text?.startsWith(IDENTITY))
    expect(identityBlocks).toHaveLength(1)
  })

  test('returns the same number of blocks as the input', () => {
    const result = withClaudeCodeIdentity(system)
    expect(result).toHaveLength(system.length)
  })

  test('identity remains at [0]', () => {
    const result = withClaudeCodeIdentity(system)
    expect(result[0].text).toBe(IDENTITY)
  })
})

// ─── Non-Claude-Code request (no identity present) ──────────────────────────

describe('non-Claude-Code request — no identity block present', () => {
  test('prepends the identity at [0]', () => {
    const system = [{ type: 'text', text: 'Custom system prompt.', cache_control: { type: 'ephemeral' } }]
    const result = withClaudeCodeIdentity(system)
    expect(result[0].text).toBe(IDENTITY)
    expect(result[0].cache_control).toBeUndefined()
  })

  test('original blocks follow the prepended identity', () => {
    const system = [{ type: 'text', text: 'Custom system prompt.', cache_control: { type: 'ephemeral' } }]
    const result = withClaudeCodeIdentity(system)
    expect(result).toHaveLength(2)
    expect(result[1].text).toBe('Custom system prompt.')
    expect(result[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  test('empty array gets only the identity block', () => {
    const result = withClaudeCodeIdentity([])
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe(IDENTITY)
  })

  test('string system is wrapped and identity is prepended when string is not the identity', () => {
    const result = withClaudeCodeIdentity('Custom system.')
    expect(result[0].text).toBe(IDENTITY)
    expect(result[1].text).toBe('Custom system.')
  })

  test('null / non-array input gets only the identity block', () => {
    const result = withClaudeCodeIdentity(null)
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe(IDENTITY)
  })
})

// ─── Regression: old blocks[0]-only check caused duplicate identity ──────────
//
// The original implementation checked only blocks[0]:
//
//   const firstText = typeof blocks[0]?.text === 'string' ? blocks[0].text : ''
//   if (firstText.startsWith(CLAUDE_CODE_IDENTITY)) return blocks
//
// Claude Code ≥2.1.146 places a billing-header at [0] and the identity at [1].
// The old check saw the billing header as the first block → prepended a new
// identity at [0] → shifted every cache_control breakpoint → 100% cache misses.

function oldWithClaudeCodeIdentity(system: unknown): Array<{ type?: string; text?: string; cache_control?: unknown }> {
  type Block = { type?: string; text?: string; cache_control?: unknown }
  function toBlock(value: unknown): Block {
    if (typeof value === 'string') return { type: 'text', text: value }
    if (value === null || typeof value !== 'object') return {}
    return {
      type: typeof Reflect.get(value, 'type') === 'string' ? (Reflect.get(value, 'type') as string) : undefined,
      text: typeof Reflect.get(value, 'text') === 'string' ? (Reflect.get(value, 'text') as string) : undefined,
      cache_control: Reflect.get(value, 'cache_control'),
    }
  }
  let blocks: Block[]
  if (typeof system === 'string') {
    blocks = system.length > 0 ? [{ type: 'text', text: system }] : []
  } else if (Array.isArray(system)) {
    blocks = system.map(toBlock)
  } else {
    blocks = []
  }
  // OLD logic: only checks blocks[0]
  const firstText = typeof blocks[0]?.text === 'string' ? blocks[0].text : ''
  if (firstText.startsWith(IDENTITY)) return blocks
  return [{ type: 'text', text: IDENTITY }, ...blocks]
}

describe('regression — old blocks[0]-only check vs. new any() check', () => {
  const system = [billingBlock, identityBlock, mainBlock, additionalBlock]

  test('old code: prepends a duplicate identity, producing 5 blocks instead of 4', () => {
    const result = oldWithClaudeCodeIdentity(system)
    expect(result).toHaveLength(5)
    expect(result[0].text).toBe(IDENTITY)
    expect(result[1].text).toBe(billingBlock.text)
    expect(result[2].text).toBe(IDENTITY) // duplicate
  })

  test('old code: cache_control blocks are shifted to positions [3] and [4]', () => {
    const result = oldWithClaudeCodeIdentity(system)
    expect(result[3].cache_control).toEqual(mainBlock.cache_control)
    expect(result[4].cache_control).toEqual(additionalBlock.cache_control)
    // positions [0]–[2] have no cache_control
    expect(result[0].cache_control).toBeUndefined()
    expect(result[1].cache_control).toBeUndefined()
    expect(result[2].cache_control).toBeUndefined()
  })

  test('new code: passes blocks through unchanged — 4 blocks, cache_control at [2] and [3]', () => {
    const result = withClaudeCodeIdentity(system)
    expect(result).toHaveLength(4)
    expect(result[2].cache_control).toEqual(mainBlock.cache_control)
    expect(result[3].cache_control).toEqual(additionalBlock.cache_control)
  })
})

// ─── String system that IS the identity ─────────────────────────────────────

describe('system passed as a plain string equal to the identity', () => {
  test('is wrapped and returned without duplication', () => {
    const result = withClaudeCodeIdentity(IDENTITY)
    const identityBlocks = result.filter((b) => b.text?.startsWith(IDENTITY))
    expect(identityBlocks).toHaveLength(1)
  })
})

// ─── stripDisabledThinking ──────────────────────────────────────────────────

describe('stripDisabledThinking', () => {
  test('drops thinking when type is "disabled"', () => {
    const req: { thinking?: unknown } = { thinking: { type: 'disabled' } }
    stripDisabledThinking(req)
    expect(req.thinking).toBeUndefined()
  })

  test('drops thinking when type is any unrecognised value', () => {
    const req: { thinking?: unknown } = { thinking: { type: 'auto' } }
    stripDisabledThinking(req)
    expect(req.thinking).toBeUndefined()
  })

  test('preserves thinking when type is "enabled"', () => {
    const req: { thinking?: unknown } = { thinking: { type: 'enabled', budget_tokens: 4096 } }
    stripDisabledThinking(req)
    expect(req.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
  })

  test('is a no-op when thinking is undefined', () => {
    const req: { thinking?: unknown } = {}
    stripDisabledThinking(req)
    expect('thinking' in req).toBe(false)
  })

  test('is a no-op when thinking is null', () => {
    const req: { thinking?: unknown } = { thinking: null }
    stripDisabledThinking(req)
    expect(req.thinking).toBeNull()
  })
})
