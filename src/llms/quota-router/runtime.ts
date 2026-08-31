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

import {
  type PreferenceConstraints,
  type QuotaAwareConstraints,
  QuotaAwareConstraintsSchema,
  type RequestedModelTier,
  type RouterPreferenceEntry,
  type ScenarioKey
} from '@/schemas'
import { logger } from '../../logger'
import { loadPreferenceChain } from '../../services/router-preference-service'
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

// Look up the candidate's Model.contextWindow via the latest scheduler
// snapshot. Null when no snapshot exists yet or the candidate isn't in
// the snapshot (scraper hasn't reached that model) — the selector
// treats null as "allow" so the gate never becomes a hard block for
// fresh installs. Kept as a factory so the snapshot is read once per
// selection call.
const buildContextWindowOf = (): ((target: string) => number | null) => {
  const snapshot = getRoutingSnapshot()
  return (target: string): number | null => {
    if (snapshot === null) return null
    return snapshot.weights.get(target)?.contextWindow ?? null
  }
}

// Tier navigation: fable > opus > sonnet > haiku (expensive → cheap).
// `tierBelow` returns the next-cheaper tier (used for downshift when
// the requested tier is over-paced); `tierAbove` returns the
// next-pricier tier (used for upshift when the requested tier has
// slack budget it won't burn on its own).
const TIER_ORDER: readonly RequestedModelTier[] = ['fable', 'opus', 'sonnet', 'haiku']
const tierBelow = (t: RequestedModelTier): RequestedModelTier | undefined => {
  const idx = TIER_ORDER.indexOf(t)
  return idx < 0 || idx === TIER_ORDER.length - 1 ? undefined : TIER_ORDER[idx + 1]
}
const tierAbove = (t: RequestedModelTier): RequestedModelTier | undefined => {
  const idx = TIER_ORDER.indexOf(t)
  return idx <= 0 ? undefined : TIER_ORDER[idx - 1]
}

// Pace-aware tier widening. Given the requested tier and the chain, look
// up the paceRatio of the top enabled candidate matching that tier in
// the snapshot and decide whether to admit an adjacent tier for this
// request. Returns undefined when there is no snapshot data, the
// window has barely started (early-window noise), or the pace sits
// inside the neutral band. In every "undefined" case the caller
// preserves the pre-Phase-2f strict-tier behaviour.
const resolveAllowedTiers = (
  requestedTier: RequestedModelTier | undefined,
  entries: readonly RouterPreferenceEntry[],
  constraints: PreferenceConstraints
): ReadonlySet<RequestedModelTier> | undefined => {
  if (requestedTier === undefined) return undefined
  const snapshot = getRoutingSnapshot()
  if (snapshot === null) return undefined
  const canonical = entries.find((e) => e.enabled && e.resolvedTier === requestedTier)
  if (canonical === undefined) return undefined
  const entry = snapshot.weights.get(canonical.target)
  if (entry === undefined) return undefined
  if (entry.paceRatio === null || entry.windowElapsedRatio === null) return undefined
  if (entry.windowElapsedRatio * 100 < constraints.pacePolicyMinElapsedPct) return undefined
  if (entry.paceRatio > constraints.paceOverThreshold) {
    const below = tierBelow(requestedTier)
    return below === undefined ? undefined : new Set<RequestedModelTier>([requestedTier, below])
  }
  if (entry.paceRatio < constraints.paceUnderThreshold) {
    const above = tierAbove(requestedTier)
    return above === undefined ? undefined : new Set<RequestedModelTier>([requestedTier, above])
  }
  return undefined
}

export interface QuotaAwareSelectionInput {
  requestedModel: string | undefined
  isSubagent: boolean
  scenario: ScenarioKey
  // Which RouterPreferenceProfile the chain comes from. Resolved from
  // the request's inbound surface, so two surfaces can run different
  // chains — a CI token's surface on cost-first while interactive
  // traffic stays on the default. Omitted = the default profile.
  profileKey?: string
  // Estimated input-token count for this request. The scenario router
  // computes it via tokenizers/base before classification; passing it
  // through lets the selector's context-window gate skip candidates
  // that can't physically hold the request. Undefined = don't gate.
  requestTokenCount?: number
}

export interface QuotaAwareSelection {
  selection: PreferenceSelection
  retryAfterSec: number | null
}

export async function resolveQuotaAwareSelection(input: QuotaAwareSelectionInput): Promise<QuotaAwareSelection> {
  // Per-kind chain lookup: `agent` for main-agent traffic, `subagent`
  // for requests carrying a <CCR-SUBAGENT-MODEL> tag. The two chains
  // are ordered independently in the DB, so the same scenario can
  // route very differently based on the caller lane.
  const kind = input.isSubagent ? 'subagent' : 'agent'
  const chain = await loadPreferenceChain(input.scenario, kind, undefined, input.profileKey)
  const constraintsParsed = QuotaAwareConstraintsSchema.safeParse(chain.constraints ?? {})
  const constraints: QuotaAwareConstraints = constraintsParsed.success
    ? constraintsParsed.data
    : QuotaAwareConstraintsSchema.parse({})
  // Not-configured shortcut: an empty preference chain for this scenario
  // means the operator hasn't set up quota-aware routing here. Treat that
  // as "no opinion" and pass through to the scenario router's answer,
  // ignoring `exhaustedBehavior: '429'` — the 429 branch is meant for
  // real chains whose candidates are all currently gated, not for the
  // "nothing to route" case. Without this, a fresh install with
  // ROUTER_MODE=quota-aware but no chain entries 429s every request.
  if (chain.entries.length === 0) {
    return { selection: { primary: null, fallbacks: [], matched: false, skipped: [] }, retryAfterSec: null }
  }
  const l4Constraints: PreferenceConstraints = constraints
  const requestedTier = input.requestedModel ? tierOf(input.requestedModel) : undefined
  // Pace-based widening only applies to agent calls — subagent tag
  // routing has its own filter (subagentTiers) that operators use to
  // pin the sub-lane, and blurring it silently would surprise them.
  const allowedTiersOverride = input.isSubagent
    ? undefined
    : resolveAllowedTiers(requestedTier, chain.entries, l4Constraints)
  const selection = selectByPreference({
    entries: chain.entries,
    constraints: l4Constraints,
    requestedTier,
    isSubagent: input.isSubagent,
    isExhausted: buildIsExhausted(),
    errorRate: buildErrorRate(),
    contextWindowOf: buildContextWindowOf(),
    requestTokenCount: input.requestTokenCount,
    allowedTiersOverride
  })
  // Retry-After hint is populated ONLY when (a) the selector produced
  // no primary AND (b) constraints.exhaustedBehavior is '429'. The
  // caller uses null-vs-number to decide between "return 429" and
  // "keep the scenario router's answer as a passthrough".
  const snapshot = getRoutingSnapshot()
  const shouldEmit429 = selection.primary === null && constraints.exhaustedBehavior === '429'
  let retryAfterSec: number | null = null
  if (shouldEmit429) {
    if (snapshot?.soonestResetAt !== null && snapshot?.soonestResetAt !== undefined) {
      retryAfterSec = Math.max(1, Math.ceil((snapshot.soonestResetAt - Date.now()) / 1000))
    } else {
      // No snapshot yet or no reset info — fall back to the L4 default
      // (30 s), matching Anthropic's typical retry hint for a soft 429.
      retryAfterSec = 30
    }
  }
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
