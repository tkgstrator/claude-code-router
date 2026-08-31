/**
 * Key-free unit tests for the preset Zod schemas and condition logic.
 * These run in CI without an API key or a running CCR server.
 */

import { describe, expect, test } from 'bun:test'
import { ConditionSchema, JsonValueSchema, PresetFileSchema, PresetMetadataSchema } from '../../src/schemas/domain/preset'
import { evaluateCondition } from '../../src/shared/preset/schema'

describe('JsonValueSchema', () => {
  test('accepts primitives', () => {
    expect(JsonValueSchema.safeParse('a').success).toBe(true)
    expect(JsonValueSchema.safeParse(1).success).toBe(true)
    expect(JsonValueSchema.safeParse(true).success).toBe(true)
    expect(JsonValueSchema.safeParse(null).success).toBe(true)
  })

  test('accepts nested objects and arrays', () => {
    const value = { a: [1, 'b', { c: null }], d: { e: true } }
    expect(JsonValueSchema.safeParse(value).success).toBe(true)
  })

  test('rejects functions and undefined', () => {
    expect(JsonValueSchema.safeParse(() => 1).success).toBe(false)
    expect(JsonValueSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('PresetMetadataSchema', () => {
  test('requires name and version', () => {
    expect(PresetMetadataSchema.safeParse({ name: 'x', version: '1.0.0' }).success).toBe(true)
    expect(PresetMetadataSchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(PresetMetadataSchema.safeParse({}).success).toBe(false)
  })

  test('rejects an unknown sourceType', () => {
    const result = PresetMetadataSchema.safeParse({
      name: 'x',
      version: '1.0.0',
      sourceType: 'ftp',
    })
    expect(result.success).toBe(false)
  })
})

describe('PresetFileSchema', () => {
  test('round-trips a minimal preset', () => {
    const preset = {
      metadata: { name: 'demo', version: '1.0.0' },
      config: {
        Providers: [
          {
            name: 'openai',
            api_base_url: 'https://api.openai.com/v1/chat/completions',
            api_key: '$OPENAI_API_KEY',
            models: ['gpt-4o-mini'],
          },
        ],
        Router: { default: 'openai,gpt-4o-mini' },
      },
    }
    const result = PresetFileSchema.safeParse(preset)
    expect(result.success).toBe(true)
  })

  test('requires config', () => {
    expect(PresetFileSchema.safeParse({ metadata: { name: 'x', version: '1' } }).success).toBe(
      false,
    )
  })

  test('keeps extra config keys via the catchall', () => {
    const result = PresetFileSchema.safeParse({
      config: { somethingCustom: { nested: [1, 2, 3] } },
    })
    expect(result.success).toBe(true)
  })
})

describe('ConditionSchema', () => {
  test('accepts a valid condition', () => {
    expect(ConditionSchema.safeParse({ field: 'tier', operator: 'eq', value: 'pro' }).success).toBe(
      true,
    )
  })

  test('rejects an unknown operator', () => {
    expect(ConditionSchema.safeParse({ field: 'tier', operator: 'matches' }).success).toBe(false)
  })
})

describe('evaluateCondition', () => {
  test('eq / ne', () => {
    expect(evaluateCondition({ field: 'a', operator: 'eq', value: 1 }, { a: 1 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'ne', value: 1 }, { a: 2 })).toBe(true)
  })

  test('exists', () => {
    expect(evaluateCondition({ field: 'a', operator: 'exists' }, { a: 0 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'exists' }, { a: null })).toBe(false)
    expect(evaluateCondition({ field: 'a', operator: 'exists' }, {})).toBe(false)
  })

  test('in / nin', () => {
    expect(evaluateCondition({ field: 'a', operator: 'in', value: [1, 2] }, { a: 2 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'nin', value: [1, 2] }, { a: 3 })).toBe(true)
  })

  test('relational operators only compare numbers', () => {
    expect(evaluateCondition({ field: 'a', operator: 'gt', value: 1 }, { a: 2 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'lte', value: 2 }, { a: 2 })).toBe(true)
    // non-numeric operands return false instead of throwing
    expect(evaluateCondition({ field: 'a', operator: 'gt', value: 'b' }, { a: 'a' })).toBe(false)
  })
})
