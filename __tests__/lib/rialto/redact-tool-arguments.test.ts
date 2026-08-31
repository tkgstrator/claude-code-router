/**
 * Tool-argument redaction.
 *
 * Tool arguments are where file paths, shell commands and pasted
 * secrets end up. Redaction is destructive and irreversible, so it has
 * to remove exactly the argument payloads and nothing else — a pass
 * that also flattened the prose would quietly make the session view
 * useless, and one that missed a nested block would leak the thing it
 * was turned on to hide.
 */
import { describe, expect, test } from 'bun:test'
import { redactToolArguments } from '../../../src/api/v1/redact'

describe('redactToolArguments', () => {
  test('replaces tool_use input while leaving the rest of the block', () => {
    const out = redactToolArguments([
      { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'cat ~/.ssh/id_rsa' } }
    ])
    expect(out).toEqual([{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: '[redacted]' }])
  })

  test('replaces tool_result content, which carries the command output', () => {
    const out = redactToolArguments([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ssh-rsa AAAA...' }])
    expect(out).toEqual([{ type: 'tool_result', tool_use_id: 'tu_1', content: '[redacted]' }])
  })

  test('leaves prose untouched — redaction must not cost the readable turn', () => {
    const blocks = [{ type: 'text', text: 'Read the key file for me' }]
    expect(redactToolArguments(blocks)).toEqual(blocks)
  })

  test('reaches blocks nested inside an array of arrays', () => {
    const out = redactToolArguments([[{ type: 'tool_use', input: { a: 1 } }]])
    expect(out).toEqual([[{ type: 'tool_use', input: '[redacted]' }]])
  })

  test('passes a plain string turn through unchanged', () => {
    expect(redactToolArguments('hello')).toBe('hello')
  })

  test('leaves a tool block that carries no payload alone rather than inventing one', () => {
    const out = redactToolArguments([{ type: 'tool_use', name: 'Noop' }])
    expect(out).toEqual([{ type: 'tool_use', name: 'Noop' }])
  })

  test('does not mutate its input', () => {
    const input = [{ type: 'tool_use', input: { command: 'ls' } }]
    redactToolArguments(input)
    expect(input[0].input).toEqual({ command: 'ls' })
  })
})
