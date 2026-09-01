/**
 * Context-window gate — a candidate whose Model.contextWindow is
 * smaller than the current request's token count is skipped before
 * exhausted / error-rate checks so the reason on the utilisation
 * dashboard is precise ("too small") rather than "picked but 400'd
 * upstream". Unknown contextWindow (null) falls through as "allow"
 * so fresh installs where the scraper hasn't run don't wedge routing.
 */

import { expect, test } from 'bun:test'
import type { PreferenceConstraints, RequestedModelTier, RouterPreferenceEntry } from '../../../src/schemas/domain'
import { selectByPreference } from '../../../src/llms/quota-router/selection'

const STRICT: PreferenceConstraints = {
  allowEscalation: false,
  allowDemotion: false,
  quotaSkipPct: 100,
  errorRateSkipPct: 0.5,
  minHealthSamples: 5,
  paceOverThreshold: 1.5,
  paceUnderThreshold: 0.5,
  pacePolicyMinElapsedPct: 20
}

const entry = (
  priority: number,
  target: string,
  resolvedTier: RequestedModelTier,
  overrides: Partial<RouterPreferenceEntry> = {}
): RouterPreferenceEntry => ({
  priority,
  target,
  enabled: overrides.enabled ?? true,
  resolvedTier
})

const HEALTHY = { isExhausted: () => false, errorRate: () => 0 }

test('skips candidates whose contextWindow is smaller than the request tokens', () => {
  const contextWindows = new Map<string, number | null>([
    ['claude-code,claude-sonnet-5', 200_000],
    ['claude-code,claude-fable-5', 1_000_000]
  ])
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-sonnet-5', 'sonnet'),
      entry(2, 'claude-code,claude-fable-5', 'fable')
    ],
    constraints: STRICT,
    requestedTier: undefined,
    isSubagent: false,
    contextWindowOf: (t) => contextWindows.get(t) ?? null,
    requestTokenCount: 500_000,
    ...HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-fable-5')
  expect(result.skipped).toEqual([{ target: 'claude-code,claude-sonnet-5', reason: 'context_too_small' }])
})

test('unknown contextWindow (null) allows the candidate through — cold-start safe', () => {
  const result = selectByPreference({
    entries: [entry(1, 'claude-code,claude-mystery', 'sonnet')],
    constraints: STRICT,
    requestedTier: undefined,
    isSubagent: false,
    contextWindowOf: () => null,
    requestTokenCount: 500_000,
    ...HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-mystery')
})

test('missing requestTokenCount disables the gate entirely (backward compat)', () => {
  const result = selectByPreference({
    entries: [entry(1, 'claude-code,claude-sonnet-5', 'sonnet')],
    constraints: STRICT,
    requestedTier: undefined,
    isSubagent: false,
    contextWindowOf: () => 100_000, // would fail if the gate ran
    requestTokenCount: undefined,
    ...HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
})

test('context gate runs before exhausted so the reason on the dashboard is precise', () => {
  const result = selectByPreference({
    entries: [entry(1, 'claude-code,claude-sonnet-5', 'sonnet')],
    constraints: STRICT,
    requestedTier: undefined,
    isSubagent: false,
    contextWindowOf: () => 100_000,
    requestTokenCount: 500_000,
    isExhausted: () => true,
    errorRate: () => 0
  })
  expect(result.primary).toBeNull()
  expect(result.skipped).toEqual([{ target: 'claude-code,claude-sonnet-5', reason: 'context_too_small' }])
})
