import { describe, expect, test } from 'bun:test'
import { normaliseContent } from '../../src/lib/sessions/message-content'

describe('normaliseContent', () => {
  test('passes through a normal user text message as `text`', () => {
    const blocks = normaliseContent('please help me refactor this')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('text')
  })

  test('classifies Claude Code permission-gate directive as system_text', () => {
    const injected = [
      'Err on the side of blocking. Stage 1 does NOT apply user intent or ALLOW',
      'exceptions — stage 2 will handle those. Judge the action by its full',
      'effect — what it runs, sends, publishes, or enables — not its surface',
      'form. Block if ANY rule could apply. <block> immediately.'
    ].join(' ')
    const blocks = normaliseContent([{ type: 'text', text: injected }])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('system_text')
  })

  test('still classifies existing tagless dumps (Available agent types) as system_text', () => {
    const blocks = normaliseContent([{ type: 'text', text: 'Available agent types:\n- foo\n- bar' }])
    expect(blocks[0]?.kind).toBe('system_text')
  })

  test('strips <system-reminder> wrappers from mixed text', () => {
    const blocks = normaliseContent([
      { type: 'text', text: 'hello world\n<system-reminder>ignore me</system-reminder>' }
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('text')
    if (blocks[0]?.kind === 'text') {
      expect(blocks[0].text).not.toContain('system-reminder')
      expect(blocks[0].text).toContain('hello world')
    }
  })
})
