/**
 * Runtime glue for the quota-aware preference selector (Phase 2e).
 *
 * `resolveQuotaAwareSelection()` composes:
 *
 *   scheduler snapshot (weights + soonestResetAt)
 *   +
 *   model-health tracker (errorRateOf)
 *   +
 *   cached usage percentages (getCachedUsagePct)
 *
 * into the two predicates `selectByPreference` needs (`isExhausted`,
 * `errorRate`). Loads the singleton preference chain via
 * `loadRouterPreferences` — the cost is a single indexed Prisma read;
 * a real production caller should memoise but Phase 2e's shadow path
 * runs alongside the scenario router so the extra latency shows up
 * only in the shadow branch.
 *
 * `logShadowDivergence()` records at INFO level when the shadow
 * selector would have chosen a different primary than the scenario
 * router did. The plan doc's Phase 2 rollout uses these logs to
 * validate the shadow's decisions before flipping to preference
 * mode.
 */

import { type PreferenceConstraints, QuotaAwareConstraintsSchema } from '@/schemas'
import { logger } from '../../logger'
import { loadRouterPreferences } from '../../services/router-preference-service'
import { getRoutingSnapshot } from '../../services/routing-scheduler'
import { errorRateOf } from '../../services/routing-scheduler/model-health'
import { getCachedUsagePct } from '../../services/usage-service'
import { tierOf } from '../scenario-router/model-selection'
import { type PreferenceSelection, selectByPreference } from './selection'

// Look up the provider/model pair behind a preference target, then
// consult (a) the scheduler snapshot's weight for the target and
// (b) the per-account cached usage percentages. Returns true when the
// candidate is unusable *right now*.
const buildIsExhausted = (): ((target: string) => boolean) => {
  const snapshot = getRoutingSnapshot()
  return (target: string): boolean => {
    if (snapshot !== null) {
      const entry = snapshot.weights.get(target)
      if (entry !== undefined && entry.weight <= 0) return true
    }
    // Fallback for shadow / preference (non-quota-aware) modes: use
    // the same per-account cache the L4 gate would use. Cache stores
    // by subAccountId + kind — but the target is provider,model.
    // Without the join we can't derive subAccountId here; the
    // scheduler snapshot is the accurate path. Return false so the
    // gate defers to the error-rate check when snapshot is absent.
    return false
  }
}

const buildErrorRate = (): ((target: string) => number) => (target) => errorRateOf(target)

export interface QuotaAwareSelectionInput {
  requestedModel: string | undefined
  isSubagent: boolean
}

export interface QuotaAwareSelection {
  selection: PreferenceSelection
  retryAfterSec: number | null
}

export async function resolveQuotaAwareSelection(input: QuotaAwareSelectionInput): Promise<QuotaAwareSelection> {
  const preferences = await loadRouterPreferences()
  const constraintsParsed = QuotaAwareConstraintsSchema.safeParse(preferences.constraints ?? {})
  const constraints: PreferenceConstraints = constraintsParsed.success
    ? constraintsParsed.data
    : QuotaAwareConstraintsSchema.parse({})
  const selection = selectByPreference({
    entries: preferences.entries,
    constraints,
    requestedTier: input.requestedModel ? tierOf(input.requestedModel) : undefined,
    isSubagent: input.isSubagent,
    isExhausted: buildIsExhausted(),
    errorRate: buildErrorRate()
  })
  // Retry-After hint from the scheduler's soonestResetAt (only useful
  // when the selector returned no primary — the caller decides whether
  // to attach it to a 429 response).
  const snapshot = getRoutingSnapshot()
  const retryAfterSec =
    selection.primary === null && snapshot?.soonestResetAt !== null && snapshot?.soonestResetAt !== undefined
      ? Math.max(1, Math.ceil((snapshot.soonestResetAt - Date.now()) / 1000))
      : null
  return { selection, retryAfterSec }
}

// Log at INFO level when the shadow's primary differs from what the
// scenario router chose. Kept as a fire-and-forget on the request
// path — never awaited, never throws.
export function logShadowDivergence(input: {
  scenarioPrimary: string | null
  shadow: PreferenceSelection
  requestedModel: string | undefined
  isSubagent: boolean
}): void {
  const shadowPrimary = input.shadow.primary
  if (shadowPrimary === input.scenarioPrimary) return
  logger.info(
    {
      scenarioPrimary: input.scenarioPrimary,
      shadowPrimary,
      shadowSkipped: input.shadow.skipped,
      requestedModel: input.requestedModel,
      isSubagent: input.isSubagent
    },
    '[routing-shadow] divergence'
  )
}

// Adapter helpers for the request pipeline. Kept as separate small
// exports so the wire-up PR (a future increment) can plug them into
// v1Route without touching selection logic.
export {
  recordModelFailure,
  recordModelSuccess
} from '../../services/routing-scheduler/model-health'
