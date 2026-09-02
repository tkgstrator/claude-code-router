/**
 * Per-candidate scoring: the `healthiness` half of the score formula.
 *
 * Sits between `quota-math` (which turns quota counters into ratios) and
 * `shaping` (which turns scores into a normalised weight vector). Keeping
 * it apart from both means the formula's four factors — preference rank,
 * budget, error rate, reset penalty — can be read in one screen, and that
 * the two early returns for a disabled entry and a de-registered model
 * sit next to the arithmetic they stand in for.
 */

import { candidatePace, earliestReset, modelBudget } from './quota-math'
import type { ModelCandidateState, SchedulerInputState, WeightReason } from './types'

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

export interface RawScore {
  target: string
  healthiness: number
  budgetPct: number | null
  earliestResetAt: number | null
  reasons: WeightReason[]
  enabled: boolean
  paceRatio: number | null
  windowElapsedRatio: number | null
  contextWindow: number | null
}

export const scoreCandidate = (
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
    return {
      target,
      healthiness: 0,
      budgetPct: null,
      earliestResetAt: null,
      reasons: ['ok'],
      enabled: false,
      paceRatio: null,
      windowElapsedRatio: null,
      contextWindow: candidate?.contextWindow ?? null
    }
  }
  if (candidate === undefined) {
    // The preference entry references a model no longer registered.
    return {
      target,
      healthiness: 0,
      budgetPct: null,
      earliestResetAt: null,
      reasons: ['no_quota_kind'],
      enabled: true,
      paceRatio: null,
      windowElapsedRatio: null,
      contextWindow: null
    }
  }

  const budgetView = modelBudget(candidate, input.now, input.ttlMs)
  const earliestResetAt = earliestReset(candidate)
  const pace = candidatePace(candidate, input.now, input.ttlMs)

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
    enabled: true,
    paceRatio: pace.paceRatio,
    windowElapsedRatio: pace.windowElapsedRatio,
    contextWindow: candidate.contextWindow
  }
}
