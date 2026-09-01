/**
 * Coverage for the condition/validation logic behind the Presets page's
 * dynamic form.
 *
 * These assertions used to live in `__tests__/preset/schema.test.ts`,
 * pointed at `src/shared/preset/schema/conditions.ts` — a twin of this
 * module inherited from the deleted CLI preset installer. Nothing in the
 * app ever imported that twin; the test was the only thing keeping it
 * alive, so the twin is gone and the coverage moved here, onto the copy
 * `RequiredInputs.tsx` actually renders with.
 */

import { describe, expect, test } from 'bun:test'
import { evaluateCondition, getOptions, shouldShowField } from '../../src/lib/presets/form-logic'
import type { PresetConfigSection, RequiredInput } from '../../src/lib/presets/types'

describe('evaluateCondition', () => {
  test('eq / ne', () => {
    expect(evaluateCondition({ field: 'a', operator: 'eq', value: 1 }, { a: 1 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'eq', value: 1 }, { a: 2 })).toBe(false)
    expect(evaluateCondition({ field: 'a', operator: 'ne', value: 1 }, { a: 2 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'ne', value: 1 }, { a: 1 })).toBe(false)
  })

  test('exists treats null as absent but keeps falsy values', () => {
    expect(evaluateCondition({ field: 'a', operator: 'exists' }, { a: 0 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'exists' }, { a: '' })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'exists' }, { a: null })).toBe(false)
    expect(evaluateCondition({ field: 'a', operator: 'exists' }, {})).toBe(false)
  })

  test('in / nin require an array operand', () => {
    expect(evaluateCondition({ field: 'a', operator: 'in', value: [1, 2] }, { a: 2 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'in', value: [1, 2] }, { a: 3 })).toBe(false)
    expect(evaluateCondition({ field: 'a', operator: 'nin', value: [1, 2] }, { a: 3 })).toBe(true)
    // A non-array operand cannot contain anything, so `in` is false and
    // `nin` is false as well rather than vacuously true.
    expect(evaluateCondition({ field: 'a', operator: 'in', value: 1 }, { a: 1 })).toBe(false)
    expect(evaluateCondition({ field: 'a', operator: 'nin', value: 1 }, { a: 1 })).toBe(false)
  })

  test('relational operators', () => {
    expect(evaluateCondition({ field: 'a', operator: 'gt', value: 1 }, { a: 2 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'lt', value: 2 }, { a: 1 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'gte', value: 2 }, { a: 2 })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'lte', value: 2 }, { a: 2 })).toBe(true)
  })

  test('relational operators fall through to JS comparison on strings', () => {
    // Documented, not endorsed: the deleted twin guarded these to numbers
    // and returned false. This copy does not, so preset authors writing a
    // string `gt` get lexicographic ordering. Pinned so the difference is
    // a decision rather than a surprise.
    expect(evaluateCondition({ field: 'a', operator: 'gt', value: 'b' }, { a: 'c' })).toBe(true)
    expect(evaluateCondition({ field: 'a', operator: 'gt', value: 'b' }, { a: 'a' })).toBe(false)
  })

  test('a missing operator degrades to equality', () => {
    expect(evaluateCondition({ field: 'a', value: 1 }, { a: 1 })).toBe(true)
    expect(evaluateCondition({ field: 'a', value: 1 }, { a: 2 })).toBe(false)
  })
})

describe('shouldShowField', () => {
  const field = (when: RequiredInput['when']): RequiredInput => ({ id: 'x', when })

  test('a field with no condition always shows', () => {
    expect(shouldShowField({ id: 'x' }, {})).toBe(true)
  })

  test('a single condition', () => {
    expect(shouldShowField(field({ field: 'tier', operator: 'eq', value: 'pro' }), { tier: 'pro' })).toBe(true)
    expect(shouldShowField(field({ field: 'tier', operator: 'eq', value: 'pro' }), { tier: 'free' })).toBe(false)
  })

  test('an array of conditions is ANDed', () => {
    const when: RequiredInput['when'] = [
      { field: 'tier', operator: 'eq', value: 'pro' },
      { field: 'key', operator: 'exists' }
    ]
    expect(shouldShowField(field(when), { tier: 'pro', key: 'sk-1' })).toBe(true)
    expect(shouldShowField(field(when), { tier: 'pro' })).toBe(false)
  })
})

describe('getOptions', () => {
  const config: PresetConfigSection = {
    Providers: [
      { name: 'openai', api_base_url: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini'] },
      { name: 'anthropic', models: ['claude-opus-4'] }
    ]
  }

  test('a literal array passes through', () => {
    const options = [{ label: 'A', value: 'a' }]
    expect(getOptions({ id: 'x', options }, config, {})).toEqual(options)
  })

  test('a field with no options yields none', () => {
    expect(getOptions({ id: 'x' }, config, {})).toEqual([])
  })

  test('type "providers" derives from the manifest', () => {
    const result = getOptions({ id: 'x', options: { type: 'providers' } }, config, {})
    expect(result.map((option) => option.value)).toEqual(['openai', 'anthropic'])
    expect(result[0]?.description).toBe('https://api.openai.com/v1')
  })

  test('type "models" follows the provider the operator picked', () => {
    const options: RequiredInput['options'] = { type: 'models', providerField: '{{provider}}' }
    expect(getOptions({ id: 'x', options }, config, { provider: 'openai' }).map((o) => o.value)).toEqual([
      'gpt-4o',
      'gpt-4o-mini'
    ])
    // Nothing picked yet, an unknown provider, or a provider with no
    // models all mean "no choice to offer" rather than an error.
    expect(getOptions({ id: 'x', options }, config, {})).toEqual([])
    expect(getOptions({ id: 'x', options }, config, { provider: 'nope' })).toEqual([])
  })

  test('type "models" without a providerField cannot resolve', () => {
    expect(getOptions({ id: 'x', options: { type: 'models' } }, config, { provider: 'openai' })).toEqual([])
  })
})
