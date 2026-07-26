import { expect, test } from 'bun:test'
import { connectModel, disconnectModel, moveFallback, setForce } from '../../../src/lib/routing-map/edit-actions'
import type { RouterConfig } from '../../../src/schemas'

// A fully-unset nested RouterConfig the tests mutate field by field.
function baseRouter(): RouterConfig {
  return {
    default: { primary: null, fallbacks: [], force: false, weeklyDrainMarginPct: 0 },
    background: { primary: null, fallbacks: [], force: false },
    think: { primary: null, fallbacks: [], force: false },
    longContext: { primary: null, fallbacks: [], force: false, threshold: 60000 },
    webSearch: { primary: null, fallbacks: [], force: false },
    image: { primary: null, fallbacks: [], force: false }
  }
}

test('connectModel sets the primary on an empty slot', () => {
  const r = connectModel(baseRouter(), 'default', 'openai,gpt-5')
  expect(r.default.primary).toBe('openai,gpt-5')
  expect(r.default.fallbacks).toEqual([])
})

test('connectModel appends a fallback when the primary is set (different provider)', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5')
  const r1 = connectModel(r0, 'default', 'anthropic,claude')
  expect(r1.default.primary).toBe('openai,gpt-5')
  expect(r1.default.fallbacks).toEqual(['anthropic,claude'])
})

test('connectModel rejects a fallback on the primary provider', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5')
  const r1 = connectModel(r0, 'default', 'openai,gpt-5-nano')
  expect(r1.default.fallbacks).toEqual([])
})

test('connectModel rejects a duplicate fallback and the primary itself', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5')
  const r1 = connectModel(r0, 'default', 'anthropic,claude')
  const r2 = connectModel(r1, 'default', 'anthropic,claude')
  const r3 = connectModel(r2, 'default', 'openai,gpt-5')
  expect(r3.default.fallbacks).toEqual(['anthropic,claude'])
})

test('setting a new primary drops fallbacks that share its provider', () => {
  const r0 = connectModel(baseRouter(), 'default', 'anthropic,claude')
  const r1 = connectModel(r0, 'default', 'openai,gpt-5')
  expect(r1.default.fallbacks).toEqual(['openai,gpt-5'])
  const r2 = disconnectModel(r1, 'default', 'anthropic,claude')
  expect(r2.default.primary).toBeNull()
  const r3 = connectModel(r2, 'default', 'openai,gpt-5-nano')
  expect(r3.default.primary).toBe('openai,gpt-5-nano')
  expect(r3.default.fallbacks).toEqual([])
})

test('disconnectModel clears the primary or drops the fallback', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5')
  const r1 = connectModel(r0, 'default', 'anthropic,claude')
  expect(disconnectModel(r1, 'default', 'openai,gpt-5').default.primary).toBeNull()
  expect(disconnectModel(r1, 'default', 'anthropic,claude').default.fallbacks).toEqual([])
})

test('moveFallback reorders the chain and no-ops out of range', () => {
  const r0 = connectModel(baseRouter(), 'default', 'x,primary')
  const r1 = connectModel(r0, 'default', 'a,one')
  const r2 = connectModel(r1, 'default', 'b,two')
  const r3 = connectModel(r2, 'default', 'c,three')
  expect(moveFallback(r3, 'default', 0, 2).default.fallbacks).toEqual(['b,two', 'c,three', 'a,one'])
  expect(moveFallback(r3, 'default', 0, 5).default.fallbacks).toEqual(['a,one', 'b,two', 'c,three'])
})

test('setForce toggles the scenario flag', () => {
  expect(setForce(baseRouter(), 'think', true).think.force).toBe(true)
  expect(setForce(baseRouter(), 'think', false).think.force).toBe(false)
})
