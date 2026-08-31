import { expect, test } from 'bun:test'
import { keepSignedBlock } from '../../src/llms/transformers/anthropic/claude-code-oauth'

// Only Anthropic can validate an Anthropic thinking signature. A block
// replayed from another provider carries either nothing or a placeholder
// Rialto minted itself, and sending either back to Anthropic 400s the
// whole request — permanently, because the transcript replays it every
// turn.

test('a real Anthropic signature is preserved', () => {
  // Dropping these would be the expensive mistake: it invalidates the
  // prompt-cache prefix and re-bills the full context every turn.
  expect(keepSignedBlock({ type: 'thinking', thinking: 'x', signature: 'ErUBCkYIBxgCIkA...' })).toBe(true)
})

test('a thinking block with no signature is dropped', () => {
  expect(keepSignedBlock({ type: 'thinking', thinking: 'x' })).toBe(false)
  expect(keepSignedBlock({ type: 'thinking', thinking: 'x', signature: '' })).toBe(false)
})

test('a Rialto-minted placeholder signature is dropped', () => {
  // Shape produced by the Gemini streaming converter when the upstream
  // returned reasoning without a signature of its own. It is non-empty,
  // so a bare emptiness check let it reach Anthropic.
  expect(keepSignedBlock({ type: 'thinking', thinking: 'x', signature: 'rialto_1756468800000' })).toBe(false)
})

test('a placeholder minted before the rename is still dropped', () => {
  // These live in transcripts written by pre-rename builds and are
  // replayed on every later turn of the same conversation. Matching only
  // the new prefix would forward them to Anthropic, which 400s the
  // conversation for good.
  expect(keepSignedBlock({ type: 'thinking', thinking: 'x', signature: 'ccr_1756468800000' })).toBe(false)
})

test('non-thinking blocks are never touched', () => {
  expect(keepSignedBlock({ type: 'text', text: 'hello' })).toBe(true)
  expect(keepSignedBlock({ type: 'tool_use', id: 't1', name: 'Read', input: {} })).toBe(true)
  // redacted_thinking is Anthropic-native and carries no signature field.
  expect(keepSignedBlock({ type: 'redacted_thinking', data: 'abc' })).toBe(true)
})

test('non-object content survives the filter', () => {
  expect(keepSignedBlock('plain string')).toBe(true)
  expect(keepSignedBlock(null)).toBe(true)
})
