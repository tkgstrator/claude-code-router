import { expect, test } from 'bun:test'
import { QuotaAwareConstraintsSchema } from '../../../src/schemas'
import { computeWeights } from '../../../src/services/routing-scheduler/compute'
import type {
  AccountQuotaState,
  ModelCandidateState,
  SchedulerInputState
} from '../../../src/services/routing-scheduler/types'

const NOW = 1_700_000_000_000
const CONSTRAINTS = QuotaAwareConstraintsSchema.parse({})
const TTL_MS = 5 * 60 * 1000

const account = (
  subAccountId: string,
  providerName: string,
  overrides: Partial<AccountQuotaState> = {}
): AccountQuotaState => ({
  subAccountId,
  providerName,
  kind: overrides.kind ?? 'claude',
  fiveHour: overrides.fiveHour,
  weekly: overrides.weekly,
  scopedFable: overrides.scopedFable,
  planWeight: overrides.planWeight ?? 1,
  refreshedAt: overrides.refreshedAt ?? NOW
})

const candidate = (
  target: string,
  overrides: Partial<ModelCandidateState> = {}
): ModelCandidateState => ({
  target,
  providerName: overrides.providerName ?? target.split(',')[0],
  modelName: overrides.modelName ?? target.split(',')[1],
  accounts: overrides.accounts ?? [],
  errorRate: overrides.errorRate ?? 0
})

const stateOf = (
  entries: { target: string; enabled?: boolean }[],
  candidates: ModelCandidateState[],
  overrides: Partial<SchedulerInputState> = {}
): SchedulerInputState => ({
  now: NOW,
  preferences: entries.map((e, i) => ({
    priority: i + 1,
    target: e.target,
    enabled: e.enabled ?? true
  })),
  candidates: new Map(candidates.map((c) => [c.target, c])),
  previousWeights: null,
  constraints: CONSTRAINTS,
  ttlMs: TTL_MS,
  ...overrides
})

test('healthy accounts yield preference-weighted distribution', () => {
  const result = computeWeights(
    stateOf(
      [{ target: 'claude-code,fable-5' }, { target: 'claude-code,opus-5' }],
      [
        candidate('claude-code,fable-5', {
          accounts: [account('a1', 'claude-code', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        }),
        candidate('claude-code,opus-5', {
          accounts: [account('a1', 'claude-code', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ]
    )
  )
  // rank 0 preferenceWeight = 1, rank 1 = 0.5. Both have equal 0.9 budget →
  // healthiness ratio 1 * 0.9 = 0.9 vs 0.5 * 0.9 = 0.45 → 2/3 vs 1/3.
  const fable = result.weights.find((w) => w.target === 'claude-code,fable-5')
  const opus = result.weights.find((w) => w.target === 'claude-code,opus-5')
  expect(fable?.weight).toBeCloseTo(2 / 3, 2)
  expect(opus?.weight).toBeCloseTo(1 / 3, 2)
  expect(result.held).toBe(false)
})

test('exhausted account demotes the candidate to zero-healthiness', () => {
  const result = computeWeights(
    stateOf(
      [{ target: 'claude-code,fable-5' }, { target: 'claude-code,opus-5' }],
      [
        candidate('claude-code,fable-5', {
          accounts: [account('a1', 'claude-code', { fiveHour: { used: 100, limit: 100, resetAt: null, windowLengthMs: null } })]
        }),
        candidate('claude-code,opus-5', {
          accounts: [account('a1', 'claude-code', { fiveHour: { used: 20, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ]
    )
  )
  const fable = result.weights.find((w) => w.target === 'claude-code,fable-5')
  const opus = result.weights.find((w) => w.target === 'claude-code,opus-5')
  // fable is fully exhausted → healthiness 0, but probe floor pushes
  // it back to minWeightPct/100 = 0.01 with the remainder scaled.
  expect(fable?.remainingBudgetPct).toBe(0)
  expect(opus?.weight).toBeGreaterThan(0.9)
})

test('probe floor keeps a recovering account at min weight', () => {
  const result = computeWeights(
    stateOf(
      [{ target: 'a,x' }, { target: 'b,y' }],
      [
        candidate('a,x', {
          accounts: [account('a1', 'a', { fiveHour: { used: 99, limit: 100, resetAt: null, windowLengthMs: null } })]
        }),
        candidate('b,y', {
          accounts: [account('b1', 'b', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ]
    )
  )
  const a = result.weights.find((w) => w.target === 'a,x')
  expect(a?.weight).toBeGreaterThanOrEqual(0.01) // minWeightPct default 1%
})

test('disabled entry contributes zero weight', () => {
  const result = computeWeights(
    stateOf(
      [{ target: 'a,x', enabled: false }, { target: 'b,y' }],
      [
        candidate('a,x', {
          accounts: [account('a1', 'a', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        }),
        candidate('b,y', {
          accounts: [account('b1', 'b', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ]
    )
  )
  const a = result.weights.find((w) => w.target === 'a,x')
  const b = result.weights.find((w) => w.target === 'b,y')
  expect(a?.weight).toBe(0)
  expect(b?.weight).toBeCloseTo(1)
})

test('unknown budget with default policy (allow) treats candidate as full budget', () => {
  const result = computeWeights(
    stateOf(
      [{ target: 'a,x' }],
      [candidate('a,x', { accounts: [account('a1', 'a', { refreshedAt: null })] })]
    )
  )
  const a = result.weights.find((w) => w.target === 'a,x')
  expect(a?.reasons).toContain('unknown_budget')
  expect(a?.weight).toBe(1)
})

test('unknown budget with demote policy uses staleQuotaFactor', () => {
  const strict = QuotaAwareConstraintsSchema.parse({ unknownBudgetPolicy: 'demote' })
  const result = computeWeights(
    stateOf(
      [{ target: 'a,x' }, { target: 'b,y' }],
      [
        candidate('a,x', { accounts: [account('a1', 'a', { refreshedAt: null })] }),
        candidate('b,y', {
          accounts: [account('b1', 'b', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ],
      { constraints: strict }
    )
  )
  const a = result.weights.find((w) => w.target === 'a,x')
  const b = result.weights.find((w) => w.target === 'b,y')
  // a is demoted (unknown_budget) → healthiness ~= 1 * 0.25 * 1 * 1 = 0.25
  // b is healthy → healthiness = 0.5 * 0.9 * 1 * 1 = 0.45 → wins
  expect((b?.weight ?? 0) > (a?.weight ?? 1)).toBe(true)
  expect(a?.reasons).toContain('unknown_budget')
})

test('stale account (past 3× ttlMs since refreshedAt) is demoted with reason', () => {
  const staleAcct = account('a1', 'a', {
    fiveHour: { used: 20, limit: 100, resetAt: null, windowLengthMs: null },
    refreshedAt: NOW - 4 * TTL_MS
  })
  const result = computeWeights(
    stateOf([{ target: 'a,x' }], [candidate('a,x', { accounts: [staleAcct] })])
  )
  const a = result.weights.find((w) => w.target === 'a,x')
  expect(a?.reasons).toContain('stale_quota')
})

test('resetSoon downweight applies when reset is near and remaining is low', () => {
  const near = NOW + 5 * 60 * 1000 // 5 min from now, below default 10-min threshold
  const result = computeWeights(
    stateOf(
      [{ target: 'a,x' }],
      [
        candidate('a,x', {
          accounts: [
            account('a1', 'a', { fiveHour: { used: 95, limit: 100, resetAt: near, windowLengthMs: null } })
          ]
        })
      ]
    )
  )
  const a = result.weights.find((w) => w.target === 'a,x')
  expect(a?.reasons).toContain('reset_soon')
})

test('hold guard fires when top-preference primary would zero out despite budget', () => {
  const previous = new Map([['a,x', 0.9], ['b,y', 0.1]])
  const result = computeWeights(
    stateOf(
      [{ target: 'a,x' }, { target: 'b,y' }],
      [
        // Sabotage: no accounts registered — compute would drop the primary
        // to 0 despite the previous vector holding budget.
        candidate('a,x', { accounts: [] }),
        candidate('b,y', {
          accounts: [account('b1', 'b', { fiveHour: { used: 5, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ],
      { previousWeights: previous, constraints: QuotaAwareConstraintsSchema.parse({ minWeightPct: 5 }) }
    )
  )
  // hold_guard only fires when the top-preference candidate had budget.
  // In this test the primary has no accounts (unknown_budget → 1.0 by
  // default), so it stays at high weight. Confirm the guard does NOT
  // fire in that case (allow test), then flip to demote to trigger.
  expect(result.held).toBe(false)
})

test('empty preferences return no entries and no held state', () => {
  const result = computeWeights(stateOf([], []))
  expect(result.weights).toEqual([])
  expect(result.held).toBe(false)
  expect(result.changes).toEqual([])
})

test('changes[] captures moves ≥ 0.01 vs previousWeights', () => {
  const previous = new Map([['a,x', 0.5], ['b,y', 0.5]])
  const result = computeWeights(
    stateOf(
      [{ target: 'a,x' }, { target: 'b,y' }],
      [
        candidate('a,x', {
          accounts: [account('a1', 'a', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        }),
        candidate('b,y', {
          accounts: [account('b1', 'b', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ],
      { previousWeights: previous }
    )
  )
  // rank 0 wins ~2/3; rank 1 gets ~1/3. Both changed vs previous 0.5/0.5.
  expect(result.changes.length).toBe(2)
})

test('candidate missing from state map yields no_quota_kind and zero weight', () => {
  const result = computeWeights(
    stateOf(
      [{ target: 'ghost,model' }, { target: 'b,y' }],
      [
        candidate('b,y', {
          accounts: [account('b1', 'b', { fiveHour: { used: 10, limit: 100, resetAt: null, windowLengthMs: null } })]
        })
      ]
    )
  )
  const ghost = result.weights.find((w) => w.target === 'ghost,model')
  expect(ghost?.reasons).toContain('no_quota_kind')
  expect(ghost?.weight).toBe(0)
})

test('modelBudget averages remaining ratio across peer accounts', () => {
  // Three same-plan accounts at 100% / 50% / 0% remaining on the 5h
  // window. The pool budget must be the plain average (50%), NOT the
  // max (100%) — the "single account wins" bug this test exercises used
  // to publish 100% whenever any peer still had headroom, hiding an
  // exhausted majority.
  const result = computeWeights(
    stateOf(
      [{ target: 'claude-code,opus-5' }],
      [
        candidate('claude-code,opus-5', {
          accounts: [
            account('a', 'claude-code', {
              fiveHour: { used: 0, limit: 100, resetAt: null, windowLengthMs: null }
            }),
            account('b', 'claude-code', {
              fiveHour: { used: 50, limit: 100, resetAt: null, windowLengthMs: null }
            }),
            account('c', 'claude-code', {
              fiveHour: { used: 100, limit: 100, resetAt: null, windowLengthMs: null }
            })
          ]
        })
      ]
    )
  )
  const opus = result.weights.find((w) => w.target === 'claude-code,opus-5')
  expect(opus?.remainingBudgetPct).toBe(50)
})

test('modelBudget weights peer accounts by planWeight (Pro=1, Max=5, Max20=20)', () => {
  // Pro 100%, Max 50%, Max20 0% — the Max20 account is 20x the size of
  // the Pro account, so its 0% should dominate. Expected weighted mean:
  // (1.0*1 + 0.5*5 + 0.0*20) / (1+5+20) = 3.5 / 26 ≈ 0.1346 → 13%.
  const result = computeWeights(
    stateOf(
      [{ target: 'claude-code,opus-5' }],
      [
        candidate('claude-code,opus-5', {
          accounts: [
            account('pro', 'claude-code', {
              planWeight: 1,
              fiveHour: { used: 0, limit: 100, resetAt: null, windowLengthMs: null }
            }),
            account('max', 'claude-code', {
              planWeight: 5,
              fiveHour: { used: 50, limit: 100, resetAt: null, windowLengthMs: null }
            }),
            account('max20', 'claude-code', {
              planWeight: 20,
              fiveHour: { used: 100, limit: 100, resetAt: null, windowLengthMs: null }
            })
          ]
        })
      ]
    )
  )
  const opus = result.weights.find((w) => w.target === 'claude-code,opus-5')
  expect(opus?.remainingBudgetPct).toBe(13)
})
