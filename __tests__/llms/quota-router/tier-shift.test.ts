/**
 * Pace-aware tier widening via `allowedTiersOverride`.
 *
 * When runtime.ts detects an over-paced requested tier it sets
 * allowedTiersOverride to {requested, tierBelow(requested)}; when the
 * requested tier is under-paced it sets {requested, tierAbove(requested)}.
 * selection.ts then evaluates the chain with that widened set — the
 * override takes precedence over the escalation/demotion constraint
 * gates so a lower-tier candidate is admissible even under strict
 * (both gates OFF) tier settings.
 */

import { expect, test } from 'bun:test'
import { selectByPreference } from '../../../src/llms/quota-router/selection'
import type { PreferenceConstraints, RequestedModelTier, RouterPreferenceEntry } from '../../../src/schemas/domain'

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

const CHAIN: readonly RouterPreferenceEntry[] = [
  entry(1, 'claude-code,claude-fable-5', 'fable'),
  entry(2, 'claude-code,claude-opus-5', 'opus'),
  entry(3, 'claude-code,claude-sonnet-5', 'sonnet'),
  entry(4, 'claude-code,claude-haiku-5', 'haiku')
]

const HEALTHY = { isExhausted: () => false, errorRate: () => 0 }

test('sonnet request with strict tier + no override → sonnet only', () => {
  const result = selectByPreference({
    entries: CHAIN,
    constraints: STRICT,
    requestedTier: 'sonnet',
    isSubagent: false,
    ...HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
})

test('sonnet request with downshift override → sonnet or haiku', () => {
  // Fable + Opus stay excluded (not in the override set); sonnet is the
  // first eligible entry.
  const result = selectByPreference({
    entries: CHAIN,
    constraints: STRICT,
    requestedTier: 'sonnet',
    isSubagent: false,
    allowedTiersOverride: new Set<RequestedModelTier>(['sonnet', 'haiku']),
    ...HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
  expect(result.fallbacks).toEqual(['claude-code,claude-haiku-5'])
  // Fable / Opus rejected via the pace-widened tier filter.
  expect(result.skipped.map((s) => s.target)).toEqual(['claude-code,claude-fable-5', 'claude-code,claude-opus-5'])
})

test('sonnet request with downshift override + exhausted sonnet → falls to haiku', () => {
  const result = selectByPreference({
    entries: CHAIN,
    constraints: STRICT,
    requestedTier: 'sonnet',
    isSubagent: false,
    allowedTiersOverride: new Set<RequestedModelTier>(['sonnet', 'haiku']),
    isExhausted: (t) => t === 'claude-code,claude-sonnet-5',
    errorRate: () => 0
  })
  expect(result.primary).toBe('claude-code,claude-haiku-5')
})

test('sonnet request with upshift override → sonnet or opus, primary is opus (higher rank)', () => {
  const result = selectByPreference({
    entries: CHAIN,
    constraints: STRICT,
    requestedTier: 'sonnet',
    isSubagent: false,
    allowedTiersOverride: new Set<RequestedModelTier>(['sonnet', 'opus']),
    ...HEALTHY
  })
  // Opus is rank 2 in the chain, sonnet is rank 3 — the widening
  // deliberately admits an upshift so the higher-tier candidate wins.
  expect(result.primary).toBe('claude-code,claude-opus-5')
  expect(result.fallbacks).toEqual(['claude-code,claude-sonnet-5'])
})

test('override takes precedence over the loose escalation/demotion gates', () => {
  const loose: PreferenceConstraints = { ...STRICT, allowEscalation: true, allowDemotion: true }
  const result = selectByPreference({
    entries: CHAIN,
    constraints: loose,
    requestedTier: 'sonnet',
    isSubagent: false,
    allowedTiersOverride: new Set<RequestedModelTier>(['sonnet', 'haiku']),
    ...HEALTHY
  })
  // Even though the constraints would otherwise let every tier
  // through, the override caps admissibility at sonnet+haiku only.
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
})
