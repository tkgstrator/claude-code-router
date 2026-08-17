import { expect, test } from 'bun:test'
import {
  PreferenceConstraintsSchema,
  QuotaAwareConstraintsSchema,
  RouterPreferenceEntrySchema,
  RouterPreferenceProfileSchema
} from '../../src/schemas'

test('PreferenceConstraintsSchema fills every knob with a documented default', () => {
  const parsed = PreferenceConstraintsSchema.parse({})
  expect(parsed.sonnetTierRespect).toBe(true)
  expect(parsed.haikuTierRespect).toBe(true)
  expect(parsed.quotaSkipPct).toBe(100)
  expect(parsed.errorRateSkipPct).toBe(0.5)
  expect(parsed.minHealthSamples).toBe(5)
})

test('QuotaAwareConstraintsSchema inherits L4 defaults and adds quota-aware knobs', () => {
  const parsed = QuotaAwareConstraintsSchema.parse({})
  // inherited
  expect(parsed.sonnetTierRespect).toBe(true)
  // added
  expect(parsed.healthinessThreshold).toBeCloseTo(0.05)
  expect(parsed.minWeightPct).toBe(1)
  expect(parsed.maxDeltaPerTick).toBeCloseTo(0.2)
  expect(parsed.dampenerEnabled).toBe(true)
  expect(parsed.resetSoonMinutes).toBe(10)
  expect(parsed.resetSoonRemainingPct).toBe(10)
  expect(parsed.resetSoonFactor).toBeCloseTo(0.25)
  expect(parsed.staleQuotaFactor).toBeCloseTo(0.25)
  expect(parsed.unknownBudgetPolicy).toBe('allow')
  expect(parsed.exhaustedBehavior).toBe('429')
})

test('QuotaAwareConstraintsSchema honours user overrides', () => {
  const parsed = QuotaAwareConstraintsSchema.parse({
    sonnetTierRespect: false,
    healthinessThreshold: 0.2,
    exhaustedBehavior: 'passthrough'
  })
  expect(parsed.sonnetTierRespect).toBe(false)
  expect(parsed.healthinessThreshold).toBeCloseTo(0.2)
  expect(parsed.exhaustedBehavior).toBe('passthrough')
  // untouched knob still defaults
  expect(parsed.minWeightPct).toBe(1)
})

test('QuotaAwareConstraintsSchema rejects out-of-range values', () => {
  expect(() => QuotaAwareConstraintsSchema.parse({ healthinessThreshold: 1.5 })).toThrow()
  expect(() => QuotaAwareConstraintsSchema.parse({ minWeightPct: 20 })).toThrow()
  expect(() => QuotaAwareConstraintsSchema.parse({ maxDeltaPerTick: 0 })).toThrow()
  expect(() => QuotaAwareConstraintsSchema.parse({ resetSoonMinutes: -1 })).toThrow()
  expect(() => QuotaAwareConstraintsSchema.parse({ resetSoonMinutes: 0 })).toThrow()
  expect(() => QuotaAwareConstraintsSchema.parse({ exhaustedBehavior: 'other' })).toThrow()
})

test('RouterPreferenceEntrySchema defaults enabled true and subagentTiers []', () => {
  const parsed = RouterPreferenceEntrySchema.parse({
    priority: 1,
    target: 'claude-code,claude-fable-5'
  })
  expect(parsed.enabled).toBe(true)
  expect(parsed.subagentTiers).toEqual([])
})

test('RouterPreferenceEntrySchema accepts subagentTiers filter', () => {
  const parsed = RouterPreferenceEntrySchema.parse({
    priority: 1,
    target: 'claude-code,claude-sonnet-5',
    subagentTiers: ['sonnet', 'haiku']
  })
  expect(parsed.subagentTiers).toEqual(['sonnet', 'haiku'])
})

test('RouterPreferenceEntrySchema rejects a non-positive priority', () => {
  expect(() =>
    RouterPreferenceEntrySchema.parse({ priority: 0, target: 'a,b' })
  ).toThrow()
  expect(() =>
    RouterPreferenceEntrySchema.parse({ priority: -1, target: 'a,b' })
  ).toThrow()
})

test('RouterPreferenceEntrySchema rejects unknown tier values in subagentTiers', () => {
  expect(() =>
    RouterPreferenceEntrySchema.parse({ priority: 1, target: 'a,b', subagentTiers: ['gpt'] })
  ).toThrow()
})

test('RouterPreferenceProfileSchema accepts an empty per-scenario map with null constraints', () => {
  // Every scenario/kind pair defaults to an empty array so the UI can
  // render an empty tab without a "missing" branch. Both `agent` and
  // `subagent` sub-chains are always present.
  const parsed = RouterPreferenceProfileSchema.parse({ entriesByScenario: {} })
  for (const s of ['default', 'think', 'longContext', 'webSearch', 'image'] as const) {
    expect(parsed.entriesByScenario[s].agent).toEqual([])
    expect(parsed.entriesByScenario[s].subagent).toEqual([])
  }
  expect(parsed.constraints).toBeNull()
})

test('RouterPreferenceProfileSchema round-trips populated per-(scenario, kind) chains', () => {
  // Split by kind: agent chain and subagent chain are ordered
  // independently under each scenario key. Same target may appear in
  // both without conflict.
  const input = {
    entriesByScenario: {
      default: {
        agent: [{ priority: 1, target: 'claude-code,claude-sonnet-5', enabled: true, subagentTiers: [] }],
        subagent: [{ priority: 1, target: 'claude-code,claude-haiku-4-5', enabled: true, subagentTiers: [] }]
      },
      think: {
        agent: [
          { priority: 1, target: 'claude-code,claude-opus-5', enabled: true, subagentTiers: [] },
          { priority: 2, target: 'claude-code,claude-fable-5', enabled: true, subagentTiers: [] }
        ],
        subagent: []
      }
    },
    constraints: { exhaustedBehavior: '429' }
  }
  const parsed = RouterPreferenceProfileSchema.parse(input)
  expect(parsed.entriesByScenario.default.agent).toHaveLength(1)
  expect(parsed.entriesByScenario.default.subagent).toHaveLength(1)
  expect(parsed.entriesByScenario.default.subagent[0].target).toBe('claude-code,claude-haiku-4-5')
  expect(parsed.entriesByScenario.think.agent).toHaveLength(2)
  expect(parsed.entriesByScenario.think.subagent).toEqual([])
  expect(parsed.entriesByScenario.longContext.agent).toEqual([])
  expect(parsed.entriesByScenario.longContext.subagent).toEqual([])
  expect(parsed.constraints).toEqual({ exhaustedBehavior: '429' })
})
