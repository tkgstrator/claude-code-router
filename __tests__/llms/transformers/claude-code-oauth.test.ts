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
import { withClaudeCodeIdentity } from '../../../src/llms/transformers/claude-code-oauth'

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

// ─── String system that IS the identity ─────────────────────────────────────

describe('system passed as a plain string equal to the identity', () => {
  test('is wrapped and returned without duplication', () => {
    const result = withClaudeCodeIdentity(IDENTITY)
    const identityBlocks = result.filter((b) => b.text?.startsWith(IDENTITY))
    expect(identityBlocks).toHaveLength(1)
  })
})
