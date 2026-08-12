/**
 * Pure weight computation for the routing scheduler (Phase 2d).
 *
 * `computeWeights(state)` is a total function — no clock, no DB, no
 * global state. Every input arrives on the `SchedulerInputState`; the
 * `now` field is injected so the tick loop can pass `dayjs().valueOf()`
 * while tests can pin a fixed millisecond value.
 *
 * The score formula (plan doc §8.2) is:
 *
 *   preferenceWeight(m) = (N - rank(m)) / N        // 1.0 at rank 0
 *   budget(m)           = max over usable accounts of (1 - used/limit)
 *   err(m)              = errorRate5min (already 0..1 on input)
 *   resetPenalty(m)     = resetSoonFactor when timeToReset<threshold
 *                         AND budget<threshold, else 1.0
 *
 *   healthiness(m)      = preferenceWeight × budget × (1-err) × resetPenalty
 *   weight(m)           = healthiness / Σ healthiness
 *
 * Then three guards apply (in order):
 *
 *   1. probe floor    — enabled candidates with healthiness > 0 keep at
 *                       least `minWeightPct/100`, remainder normalised.
 *   2. oscillation    — `|w-previous| > maxDeltaPerTick` clamped to
 *                       previous±maxDeltaPerTick. Off by default when
 *                       `dampenerEnabled = false`.
 *   3. hold guard     — never zero-out a preference-primary candidate
 *                       that has healthy budget. Returns `held=true`
 *                       and the previous vector when the guard fires.
 */

import type {
  AccountQuotaState,
  ComputeResult,
  ModelCandidateState,
  SchedulerInputState,
  WeightChange,
  WeightEntry,
  WeightReason
} from './types'

const STALE_MULTIPLIER = 3 // "stale" when refreshedAt older than 3 * ttlMs

// One window's remaining budget as a 0..1 ratio. Any missing / invalid
// pair collapses to null so `budgetOf` can decide whether to treat the
// account as unknown-budget.
const remainingRatio = (window: { used: number; limit: number }): number | null => {
  if (window.limit <= 0) return null
  const r = 1 - window.used / window.limit
  if (Number.isNaN(r)) return null
  return Math.max(0, Math.min(1, r))
}

// Budget for one account: min across every binding window. A null
// window is treated as "no data" and doesn't participate in the min
// (an account with only a 5h reading and no weekly still ranks on
// the 5h remaining).
const accountBudget = (acct: AccountQuotaState): number | null => {
  const five = acct.fiveHour === undefined ? null : remainingRatio(acct.fiveHour)
  const week = acct.weekly === undefined ? null : remainingRatio(acct.weekly)
  if (five === null && week === null) return null
  if (five === null) return week
  if (week === null) return five
  return Math.min(five, week)
}

const accountStale = (acct: AccountQuotaState, now: number, ttlMs: number): boolean => {
  if (acct.refreshedAt === null) return false // cold-start = not stale (see unknown handling)
  return now - acct.refreshedAt > STALE_MULTIPLIER * ttlMs
}

const accountKnown = (acct: AccountQuotaState): boolean => acct.fiveHour !== undefined || acct.weekly !== undefined

// Aggregate budget for a candidate model: max across usable accounts.
// Matches session-account-router's "route to the account with the
// most headroom" behaviour. Returns { value, unknownAccounts,
// staleAccounts } so `computeWeights` can attach reasons.
interface BudgetView {
  value: number | null
  unknownAccounts: number
  staleAccounts: number
}

const modelBudget = (candidate: ModelCandidateState, now: number, ttlMs: number): BudgetView => {
  let best: number | null = null
  let unknownAccounts = 0
  let staleAccounts = 0
  for (const acct of candidate.accounts) {
    if (!accountKnown(acct)) {
      unknownAccounts += 1
      continue
    }
    if (accountStale(acct, now, ttlMs)) {
      staleAccounts += 1
      continue
    }
    const b = accountBudget(acct)
    if (b === null) {
      unknownAccounts += 1
      continue
    }
    if (best === null || b > best) best = b
  }
  return { value: best, unknownAccounts, staleAccounts }
}

// Earliest resetAt across the candidate's accounts (used for the
// resetSoon downweight). Null when no reset is known.
const earliestReset = (candidate: ModelCandidateState): number | null => {
  let earliest: number | null = null
  for (const acct of candidate.accounts) {
    const cands: (number | null)[] = [acct.fiveHour?.resetAt ?? null, acct.weekly?.resetAt ?? null]
    for (const c of cands) {
      if (c === null) continue
      if (earliest === null || c < earliest) earliest = c
    }
  }
  return earliest
}

const resetPenalty = (
  budgetValue: number,
  earliestResetAt: number | null,
  now: number,
  constraints: SchedulerInputState['constraints']
): number => {
  if (earliestResetAt === null) return 1
  const minutesToReset = (earliestResetAt - now) / 60_000
  if (minutesToReset < 0) return 1
  if (minutesToReset >= constraints.resetSoonMinutes) return 1
  if (budgetValue * 100 >= constraints.resetSoonRemainingPct) return 1
  return constraints.resetSoonFactor
}

interface RawScore {
  target: string
  healthiness: number
  budgetPct: number | null
  earliestResetAt: number | null
  reasons: WeightReason[]
  enabled: boolean
}

const scoreCandidate = (
  target: string,
  rankIndex: number,
  totalRanks: number,
  candidate: ModelCandidateState | undefined,
  input: SchedulerInputState,
  enabled: boolean
): RawScore => {
  const reasons: WeightReason[] = []
  const preferenceWeight = totalRanks === 0 ? 0 : (totalRanks - rankIndex) / totalRanks

  if (!enabled) {
    return { target, healthiness: 0, budgetPct: null, earliestResetAt: null, reasons: ['ok'], enabled: false }
  }
  if (candidate === undefined) {
    // The preference entry references a model no longer registered.
    return {
      target,
      healthiness: 0,
      budgetPct: null,
      earliestResetAt: null,
      reasons: ['no_quota_kind'],
      enabled: true
    }
  }

  const budgetView = modelBudget(candidate, input.now, input.ttlMs)
  const earliestResetAt = earliestReset(candidate)

  // Budget resolution: known value > stale demotion > cold-start allow.
  let budgetValue: number
  if (budgetView.value !== null) {
    budgetValue = budgetView.value
  } else if (budgetView.staleAccounts > 0) {
    reasons.push('stale_quota')
    budgetValue = input.constraints.staleQuotaFactor
  } else {
    reasons.push('unknown_budget')
    budgetValue = input.constraints.unknownBudgetPolicy === 'demote' ? input.constraints.staleQuotaFactor : 1
  }

  const errAdjust = Math.max(0, 1 - candidate.errorRate)
  if (candidate.errorRate > 0) reasons.push('error_rate')

  const penalty = resetPenalty(budgetValue, earliestResetAt, input.now, input.constraints)
  if (penalty < 1) reasons.push('reset_soon')

  const healthiness = preferenceWeight * budgetValue * errAdjust * penalty
  if (reasons.length === 0) reasons.push('ok')

  return {
    target,
    healthiness,
    budgetPct: budgetView.value === null ? null : Math.round(budgetView.value * 100),
    earliestResetAt,
    reasons,
    enabled: true
  }
}

const normalize = (raws: readonly RawScore[]): Map<string, number> => {
  const enabled = raws.filter((r) => r.enabled)
  const sum = enabled.reduce((acc, r) => acc + r.healthiness, 0)
  const out = new Map<string, number>()
  if (sum <= 0) {
    for (const r of raws) out.set(r.target, 0)
    return out
  }
  for (const r of raws) out.set(r.target, r.enabled ? r.healthiness / sum : 0)
  return out
}

// Probe floor: any enabled candidate with healthiness > 0 gets
// max(current, minWeightPct/100). Sum can exceed 1 after the floor,
// so we re-normalize.
const applyProbeFloor = (
  raws: readonly RawScore[],
  initial: Map<string, number>,
  minWeightPct: number
): Map<string, number> => {
  const floor = minWeightPct / 100
  if (floor <= 0) return initial
  const boosted = new Map<string, number>()
  let sum = 0
  for (const r of raws) {
    if (!r.enabled || r.healthiness <= 0) {
      boosted.set(r.target, 0)
      continue
    }
    const w = Math.max(initial.get(r.target) ?? 0, floor)
    boosted.set(r.target, w)
    sum += w
  }
  if (sum === 0) return initial
  if (sum <= 1) return boosted
  const scale = 1 / sum
  const scaled = new Map<string, number>()
  for (const [target, w] of boosted) scaled.set(target, w * scale)
  return scaled
}

// Oscillation damper: constrain each candidate's move vs `previous`.
const applyDamper = (
  next: Map<string, number>,
  previous: ReadonlyMap<string, number> | null,
  maxDelta: number
): Map<string, number> => {
  if (previous === null) return next
  if (maxDelta >= 1) return next
  const clamped = new Map<string, number>()
  let sum = 0
  for (const [target, w] of next) {
    const prev = previous.get(target) ?? w
    const upper = prev + maxDelta
    const lower = Math.max(0, prev - maxDelta)
    const c = Math.min(upper, Math.max(lower, w))
    clamped.set(target, c)
    sum += c
  }
  if (sum <= 0) return next
  const scaled = new Map<string, number>()
  for (const [target, w] of clamped) scaled.set(target, w / sum)
  return scaled
}

// Hold guard: if the top-preference candidate has healthy budget (>=
// 0.1) and its NEW weight would fall below minWeightPct/100, keep the
// previous vector unchanged. Prevents a compute bug from zeroing out
// a live primary.
const holdGuardFires = (
  raws: readonly RawScore[],
  next: Map<string, number>,
  previous: ReadonlyMap<string, number> | null,
  minWeightPct: number
): boolean => {
  if (previous === null) return false
  const top = raws.find((r) => r.enabled)
  if (top === undefined) return false
  const budget = top.budgetPct
  if (budget === null || budget < 10) return false
  const w = next.get(top.target) ?? 0
  return w < minWeightPct / 100
}

export function computeWeights(state: SchedulerInputState): ComputeResult {
  // Rank is a position among enabled entries — disabled entries do
  // not consume a rank slot. This keeps preferenceWeight = 1 for the
  // top enabled entry regardless of how many disabled ones sit above
  // it (a common "temporarily drop Fable" ordering).
  const enabledIndex = new Map<string, number>()
  let enabledCounter = 0
  for (const entry of state.preferences) {
    if (entry.enabled) {
      enabledIndex.set(entry.target, enabledCounter)
      enabledCounter += 1
    }
  }
  const totalRanks = enabledCounter
  const raws: RawScore[] = state.preferences.map((entry) =>
    scoreCandidate(
      entry.target,
      enabledIndex.get(entry.target) ?? 0,
      totalRanks,
      state.candidates.get(entry.target),
      state,
      entry.enabled
    )
  )

  const initial = normalize(raws)
  const floored = applyProbeFloor(raws, initial, state.constraints.minWeightPct)
  const damped = state.constraints.dampenerEnabled
    ? applyDamper(floored, state.previousWeights, state.constraints.maxDeltaPerTick)
    : floored

  if (holdGuardFires(raws, damped, state.previousWeights, state.constraints.minWeightPct)) {
    const heldEntries: WeightEntry[] = raws.map((r) => ({
      target: r.target,
      weight: state.previousWeights?.get(r.target) ?? 0,
      healthiness: r.healthiness,
      remainingBudgetPct: r.budgetPct,
      earliestResetAt: r.earliestResetAt,
      reasons: ['hold_guard']
    }))
    return { weights: heldEntries, held: true, changes: [] }
  }

  const entries: WeightEntry[] = raws.map((r) => ({
    target: r.target,
    weight: damped.get(r.target) ?? 0,
    healthiness: r.healthiness,
    remainingBudgetPct: r.budgetPct,
    earliestResetAt: r.earliestResetAt,
    reasons: r.reasons
  }))

  const changes: WeightChange[] = []
  if (state.previousWeights !== null) {
    for (const entry of entries) {
      const prev = state.previousWeights.get(entry.target) ?? 0
      if (Math.abs(entry.weight - prev) >= 0.01) {
        changes.push({
          target: entry.target,
          from: prev,
          to: entry.weight,
          reason: entry.reasons[0] ?? 'ok'
        })
      }
    }
  }

  return { weights: entries, held: false, changes }
}
