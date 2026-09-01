import { describe, expect, test } from 'bun:test'
import {
  copyName,
  countWords,
  estimateTokens,
  promptExcerpt,
  toDrafts
} from '../../../../src/lib/rialto/settings-content/persona'

describe('countWords', () => {
  test('counts whitespace-separated words across lines', () => {
    expect(countWords('You are Yachiyo,\nthe operator’s pair.')).toBe(6)
  })

  test('treats a blank prompt as zero, not one', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\n  ')).toBe(0)
  })
})

describe('estimateTokens', () => {
  test('applies the four-characters-per-token rule of thumb', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('promptExcerpt', () => {
  test('skips leading blank lines', () => {
    expect(promptExcerpt('\n\n  Direct. State the finding.')).toBe('Direct. State the finding.')
  })

  test('clips to the requested width with an ellipsis', () => {
    expect(promptExcerpt('abcdefghij', 5)).toBe('abcd…')
  })

  test('returns empty for a prompt with no content', () => {
    expect(promptExcerpt('   \n  ')).toBe('')
  })
})

describe('copyName', () => {
  test('uses the plain copy name when it is free', () => {
    expect(copyName('Yachiyo', ['Yachiyo'])).toBe('Yachiyo copy')
  })

  test('numbers from 2 once the plain copy name is taken', () => {
    expect(copyName('Yachiyo', ['Yachiyo', 'Yachiyo copy'])).toBe('Yachiyo copy 2')
    expect(copyName('Yachiyo', ['Yachiyo', 'Yachiyo copy', 'Yachiyo copy 2'])).toBe('Yachiyo copy 3')
  })
})

describe('toDrafts', () => {
  test('keeps an existing uuid', () => {
    const drafts = toDrafts([{ id: 'abc', name: 'Terse', prompt: 'Be brief.' }])
    expect(drafts).toEqual([{ id: 'abc', name: 'Terse', prompt: 'Be brief.' }])
  })

  test('backfills a uuid for a persona written before the migration', () => {
    const drafts = toDrafts([{ name: 'Terse', prompt: '' }])
    expect(drafts[0].id).not.toBe('')
    expect(drafts[0].name).toBe('Terse')
  })
})
