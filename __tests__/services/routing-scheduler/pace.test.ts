/**
 * paceRatio + windowElapsedRatio propagation through the pure
 * `computeWeights`. The scheduler exposes both fields on every
 * WeightEntry so runtime.ts can decide whether to widen the tier gate
 * for a request without recomputing per-account maths on the hot
 * path.
 */

import { describe, expect, test } from 'bun:test'
import { computeWeights } from '../../../src/services/routing-scheduler/compute'
import type { QuotaAwareConstraints } from '../../../src/schemas'
import type { AccountQuotaState, ModelCandidateState, SchedulerInputState } from '../../../src/services/routing-scheduler/types'

const DEFAULT_CONSTRAINTS: QuotaAwareConstraints = {
  allowEscalation: false,
  allowDemotion: false,
  quotaSkipPct: 100,
  errorRateSkipPct: 0.5,
  minHealthSamples: 5,
  paceOverThreshold: 1.5,
  paceUnderThreshold: 0.5,
  pacePolicyMinElapsedPct: 20,
  healthinessThreshold: 0.05,
  minWeightPct: 1,
  maxDeltaPerTick: 0.2,
  dampenerEnabled: true,
  resetSoonMinutes: 10,
  resetSoonRemainingPct: 10,
  resetSoonFactor: 0.25,
  staleQuotaFactor: 0.25,
  unknownBudgetPolicy: 'allow',
  exhaustedBehavior: '429'
}

const HOUR = 60 * 60 * 1000
const FIVE_HOURS = 5 * HOUR

const account = (
  used: number,
  limit: number,
  windowStartedAgoMs: number,
  windowLengthMs: number,
  refreshedAtMs: number = 0
): AccountQuotaState => ({
  subAccountId: 'acct-1',
  kind: 'claude',
  providerName: 'claude-code',
  fiveHour: {
    used,
    limit,
    resetAt: refreshedAtMs + windowLengthMs - windowStartedAgoMs,
    windowLengthMs
  },
  weekly: undefined,
  refreshedAt: refreshedAtMs
})

const candidate = (target: string, acct: AccountQuotaState): ModelCandidateState => ({
  target,
  accounts: [acct],
  errorRate: 0
})

const runCompute = (
  candidateOverrides: (now: number) => Map<string, ModelCandidateState>,
  constraintOverrides: Partial<QuotaAwareConstraints> = {}
): SchedulerInputState & { result: ReturnType<typeof computeWeights> } => {
  const now = 1_000_000_000_000
  const input: SchedulerInputState = {
    now,
    preferences: [{ priority: 1, target: 'claude-code,claude-fable-5', enabled: true }],
    candidates: candidateOverrides(now),
    previousWeights: null,
    constraints: { ...DEFAULT_CONSTRAINTS, ...constraintOverrides },
    ttlMs: 5 * 60 * 1000
  }
  const result = computeWeights(input)
  return { ...input, result }
}

describe('computeWeights — paceRatio propagation', () => {
  test('over-paced 5h window: 50% consumed at 25% elapsed → paceRatio ≈ 2.0', () => {
    const { result } = runCompute((now) => {
      const acct = account(50, 100, FIVE_HOURS * 0.25, FIVE_HOURS, now)
      return new Map([['claude-code,claude-fable-5', candidate('claude-code,claude-fable-5', acct)]])
    })
    const entry = result.weights[0]
    expect(entry.paceRatio).toBeCloseTo(2.0, 2)
    expect(entry.windowElapsedRatio).toBeCloseTo(0.25, 2)
  })

  test('under-paced 5h window: 10% consumed at 80% elapsed → paceRatio ≈ 0.125', () => {
    const { result } = runCompute((now) => {
      const acct = account(10, 100, FIVE_HOURS * 0.8, FIVE_HOURS, now)
      return new Map([['claude-code,claude-fable-5', candidate('claude-code,claude-fable-5', acct)]])
    })
    const entry = result.weights[0]
    expect(entry.paceRatio).toBeCloseTo(0.125, 2)
    expect(entry.windowElapsedRatio).toBeCloseTo(0.8, 2)
  })

  test('cold-start window (no resetAt/windowLength) → paceRatio null', () => {
    const { result } = runCompute((now) => {
      const acct: AccountQuotaState = {
        subAccountId: 'acct-1',
        kind: 'claude',
        providerName: 'claude-code',
        fiveHour: { used: 0, limit: 100, resetAt: null, windowLengthMs: null },
        weekly: undefined,
        refreshedAt: now
      }
      return new Map([['claude-code,claude-fable-5', candidate('claude-code,claude-fable-5', acct)]])
    })
    const entry = result.weights[0]
    expect(entry.paceRatio).toBeNull()
    expect(entry.windowElapsedRatio).toBeNull()
  })

  test('window barely started (< 1% elapsed) → paceRatio null (noise floor)', () => {
    const { result } = runCompute((now) => {
      // Just a hair after window start — 30 seconds of a 5-hour window.
      const acct = account(1, 100, 30 * 1000, FIVE_HOURS, now)
      return new Map([['claude-code,claude-fable-5', candidate('claude-code,claude-fable-5', acct)]])
    })
    const entry = result.weights[0]
    expect(entry.paceRatio).toBeNull()
    expect(entry.windowElapsedRatio).toBeNull()
  })
})
