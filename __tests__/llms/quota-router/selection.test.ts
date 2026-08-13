import { expect, test } from 'bun:test'
import type { PreferenceConstraints, RouterPreferenceEntry } from '../../../src/schemas'
import { selectByPreference } from '../../../src/llms/quota-router/selection'

const CONSTRAINTS_STRICT: PreferenceConstraints = {
  sonnetTierRespect: true,
  haikuTierRespect: true,
  quotaSkipPct: 100,
  errorRateSkipPct: 0.5,
  minHealthSamples: 5
}

const CONSTRAINTS_LOOSE: PreferenceConstraints = {
  ...CONSTRAINTS_STRICT,
  sonnetTierRespect: false,
  haikuTierRespect: false
}

const entry = (
  priority: number,
  target: string,
  overrides: Partial<RouterPreferenceEntry> = {}
): RouterPreferenceEntry => ({
  priority,
  target,
  enabled: overrides.enabled ?? true,
  subagentTiers: overrides.subagentTiers ?? []
})

const ALL_HEALTHY: Pick<
  Parameters<typeof selectByPreference>[0],
  'isExhausted' | 'errorRate'
> = {
  isExhausted: () => false,
  errorRate: () => 0
}

test('picks the first passing entry as primary and rest as fallbacks', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5'),
      entry(2, 'claude-code,claude-opus-5'),
      entry(3, 'claude-code,claude-sonnet-5')
    ],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: false,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-fable-5')
  expect(result.fallbacks).toEqual(['claude-code,claude-opus-5', 'claude-code,claude-sonnet-5'])
  expect(result.matched).toBe(true)
})

test('skips disabled entries and records the reason', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5', { enabled: false }),
      entry(2, 'claude-code,claude-opus-5')
    ],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: false,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-opus-5')
  expect(result.skipped).toContainEqual({ target: 'claude-code,claude-fable-5', reason: 'disabled' })
})

test('sonnet request stays on sonnet under strict tier respect', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5'),
      entry(2, 'claude-code,claude-opus-5'),
      entry(3, 'claude-code,claude-sonnet-5')
    ],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: 'sonnet',
    isSubagent: false,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
  expect(result.skipped.map((s) => s.reason)).toEqual(['tier_mismatch_agent', 'tier_mismatch_agent'])
})

test('sonnet request with loose respect walks the full chain', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5'),
      entry(2, 'claude-code,claude-opus-5'),
      entry(3, 'claude-code,claude-sonnet-5')
    ],
    constraints: CONSTRAINTS_LOOSE,
    requestedTier: 'sonnet',
    isSubagent: false,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-fable-5')
  expect(result.skipped).toEqual([])
})

test('subagent call restricts to entry.subagentTiers when non-empty', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5', { subagentTiers: ['sonnet', 'haiku'] }),
      entry(2, 'claude-code,claude-opus-5', { subagentTiers: ['sonnet', 'haiku'] }),
      entry(3, 'claude-code,claude-sonnet-5', { subagentTiers: ['sonnet', 'haiku'] })
    ],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: true,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
  expect(result.skipped.map((s) => s.reason)).toEqual(['tier_mismatch_subagent', 'tier_mismatch_subagent'])
})

test('subagent call with empty subagentTiers accepts every candidate', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5'),
      entry(2, 'claude-code,claude-opus-5')
    ],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: true,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-fable-5')
  expect(result.matched).toBe(true)
})

test('exhausted candidates are skipped and demoted', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5'),
      entry(2, 'claude-code,claude-opus-5')
    ],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: false,
    isExhausted: (t) => t === 'claude-code,claude-fable-5',
    errorRate: () => 0
  })
  expect(result.primary).toBe('claude-code,claude-opus-5')
  expect(result.skipped).toContainEqual({ target: 'claude-code,claude-fable-5', reason: 'exhausted' })
})

test('error rate at or above errorRateSkipPct skips the candidate', () => {
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5'),
      entry(2, 'claude-code,claude-opus-5')
    ],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: false,
    isExhausted: () => false,
    errorRate: (t) => (t === 'claude-code,claude-fable-5' ? 0.6 : 0)
  })
  expect(result.primary).toBe('claude-code,claude-opus-5')
  expect(result.skipped).toContainEqual({ target: 'claude-code,claude-fable-5', reason: 'error_rate' })
})

test('error rate exactly at threshold still skips (>= comparison)', () => {
  const result = selectByPreference({
    entries: [entry(1, 'claude-code,claude-fable-5')],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: false,
    isExhausted: () => false,
    errorRate: () => 0.5
  })
  expect(result.primary).toBeNull()
  expect(result.matched).toBe(false)
})

test('all-fail returns primary=null and matched=false', () => {
  const result = selectByPreference({
    entries: [entry(1, 'claude-code,claude-fable-5'), entry(2, 'claude-code,claude-opus-5')],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: false,
    isExhausted: () => true,
    errorRate: () => 0
  })
  expect(result.primary).toBeNull()
  expect(result.fallbacks).toEqual([])
  expect(result.matched).toBe(false)
})

test('malformed target skipped on tier mismatch when respect is strict', () => {
  const result = selectByPreference({
    entries: [entry(1, 'malformed'), entry(2, 'claude-code,claude-sonnet-5')],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: 'sonnet',
    isSubagent: false,
    ...ALL_HEALTHY
  })
  // The malformed target's tier is unknown → strict sonnet respect
  // rejects it and picks the real sonnet entry.
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
})

test('empty chain returns no primary', () => {
  const result = selectByPreference({
    entries: [],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: undefined,
    isSubagent: false,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBeNull()
  expect(result.matched).toBe(false)
})

test('opus request has no respect knob — any tier is accepted', () => {
  const result = selectByPreference({
    entries: [entry(1, 'claude-code,claude-sonnet-5'), entry(2, 'claude-code,claude-opus-5')],
    constraints: CONSTRAINTS_STRICT,
    requestedTier: 'opus',
    isSubagent: false,
    ...ALL_HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
})
