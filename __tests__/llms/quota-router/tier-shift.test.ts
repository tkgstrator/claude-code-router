/**
 * Pace-aware tier widening via `allowedTiersOverride`.
 *
 * When runtime.ts detects an over-paced requested tier it sets
 * allowedTiersOverride to {requested, tierBelow(requested)}; when the
 * requested tier is under-paced it sets {requested, tierAbove(requested)}.
 * selection.ts then evaluates the chain with that widened set — a
 * lower-tier candidate is admissible even though sonnetTierRespect etc.
 * would otherwise reject it.
 */

import { expect, test } from 'bun:test'
import type { PreferenceConstraints, RequestedModelTier, RouterPreferenceEntry } from '../../../src/schemas'
import { selectByPreference } from '../../../src/llms/quota-router/selection'

const STRICT: PreferenceConstraints = {
  sonnetTierRespect: true,
  haikuTierRespect: true,
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
  subagentTiers: overrides.subagentTiers ?? [],
  resolvedTier
})

const CHAIN: readonly RouterPreferenceEntry[] = [
  entry(1, 'claude-code,claude-fable-5', 'fable'),
  entry(2, 'claude-code,claude-opus-5', 'opus'),
  entry(3, 'claude-code,claude-sonnet-5', 'sonnet'),
  entry(4, 'claude-code,claude-haiku-5', 'haiku')
]

const HEALTHY = { isExhausted: () => false, errorRate: () => 0 }

test('sonnet request with strict respect + no override → sonnet only', () => {
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
  expect(result.skipped.map((s) => s.target)).toEqual([
    'claude-code,claude-fable-5',
    'claude-code,claude-opus-5'
  ])
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

test('override takes precedence over sonnetTierRespect=false looseness', () => {
  const loose: PreferenceConstraints = { ...STRICT, sonnetTierRespect: false, haikuTierRespect: false }
  const result = selectByPreference({
    entries: CHAIN,
    constraints: loose,
    requestedTier: 'sonnet',
    isSubagent: false,
    allowedTiersOverride: new Set<RequestedModelTier>(['sonnet', 'haiku']),
    ...HEALTHY
  })
  // Even though the respect flags are off (would otherwise allow any
  // tier), the override caps admissibility at sonnet+haiku only.
  expect(result.primary).toBe('claude-code,claude-sonnet-5')
})

test('subagent calls do not use allowedTiersOverride (subagentTiers filter runs instead)', () => {
  // Runtime never sets the override for subagent calls, but even if a
  // caller passed one the subagent branch bypasses tierMatchesAgent
  // entirely — assert the chain is still filtered by subagentTiers.
  const result = selectByPreference({
    entries: [
      entry(1, 'claude-code,claude-fable-5', 'fable', { subagentTiers: ['haiku'] }),
      entry(2, 'claude-code,claude-haiku-5', 'haiku', { subagentTiers: ['haiku'] })
    ],
    constraints: STRICT,
    requestedTier: 'haiku',
    isSubagent: true,
    allowedTiersOverride: new Set<RequestedModelTier>(['haiku', 'sonnet']),
    ...HEALTHY
  })
  expect(result.primary).toBe('claude-code,claude-haiku-5')
})
