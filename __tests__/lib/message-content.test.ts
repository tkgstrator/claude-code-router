import { describe, expect, test } from 'bun:test'
import { normaliseContent } from '../../src/lib/sessions/message-content'

describe('normaliseContent', () => {
  test('passes through a normal user text message as `text`', () => {
    const blocks = normaliseContent('please help me refactor this')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('text')
  })

  test('classifies "Err on the side of blocking..." permission-gate as system_text', () => {
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

  test('classifies the "Stage 1 does NOT apply user intent..." variant as system_text', () => {
    // Same directive body, opener stripped (observed in production).
    const injected = [
      'Stage 1 does NOT apply user intent or ALLOW exceptions — stage 2 will',
      'handle those. Judge the action by its full effect — what it runs, sends,',
      'publishes, or enables — not its surface form. Block if ANY rule could',
      'apply. <block> immediately.'
    ].join(' ')
    const blocks = normaliseContent([{ type: 'text', text: injected }])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('system_text')
  })

  test('does NOT flag ordinary chat that mentions "block" without stage wording', () => {
    const blocks = normaliseContent([
      { type: 'text', text: "please add a code block to the readme showing the <block> tag" }
    ])
    expect(blocks[0]?.kind).toBe('text')
  })

  test('does NOT flag ordinary chat that mentions "Stage 1" without the sentinel', () => {
    const blocks = normaliseContent([
      { type: 'text', text: 'we finished Stage 1 of the migration, moving on to Stage 2 now' }
    ])
    expect(blocks[0]?.kind).toBe('text')
  })

  test('classifies "The user stepped away and is coming back..." recap directive as system_text', () => {
    const injected = [
      'The user stepped away and is coming back. Recap in under 40 words,',
      '1-2 plain sentences, no markdown. Lead with the overall goal and',
      'current task, then the one next action. Skip root-cause narrative.'
    ].join(' ')
    const blocks = normaliseContent([{ type: 'text', text: injected }])
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
