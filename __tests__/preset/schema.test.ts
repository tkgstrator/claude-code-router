/**
 * Key-free unit tests for the JSON value schemas in
 * `src/schemas/domain/preset.ts`. These run in CI without an API key or a
 * running Rialto server.
 *
 * Scope note: this file used to also exercise the preset *manifest*
 * schemas (`PresetFileSchema` / `PresetMetadataSchema` / `ConditionSchema`)
 * and the condition evaluator in `src/shared/preset/`. That evaluator was
 * a dead twin of `src/lib/presets/form-logic.ts` and has been deleted; its
 * coverage moved to `__tests__/lib/preset-form-logic.test.ts`. What is
 * asserted here is the half of the module the app actually reads:
 * `JsonValueSchema` backs the free-form JSON in `schemas/api/config.ts`
 * and `schemas/domain/config.ts`.
 */

import { describe, expect, test } from 'bun:test'
import { JsonObjectSchema, JsonValueSchema } from '../../src/schemas/domain/preset'

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

describe('JsonObjectSchema', () => {
  test('accepts a record of JSON values', () => {
    expect(JsonObjectSchema.safeParse({ a: 1, b: [null, 'x'] }).success).toBe(true)
  })

  test('rejects a non-object', () => {
    expect(JsonObjectSchema.safeParse([1, 2]).success).toBe(false)
    expect(JsonObjectSchema.safeParse('a').success).toBe(false)
  })

  test('rejects an empty key', () => {
    expect(JsonObjectSchema.safeParse({ '': 1 }).success).toBe(false)
  })
})
