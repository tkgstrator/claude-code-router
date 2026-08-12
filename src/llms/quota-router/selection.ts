/**
 * Pure preference-based selector (Phase 2c of the quota-aware router).
 *
 * Given an ordered preference chain, an optional request tier, and a
 * set of predicates (`isExhausted`, `errorRate`), return the first
 * candidate that passes every gate as `primary` and the remaining
 * passing candidates as `fallbacks`. The output is fed into the
 * existing `attemptChainEntry` machinery unchanged — this module NEVER
 * calls the network, the DB, or any effect.
 *
 * Gates applied per candidate (short-circuit order matters — cheap
 * checks first):
 *
 *   1. `entry.enabled` (soft toggle)
 *   2. Tier match (Open Question 1 / 11):
 *      - agent  call: `sonnetTierRespect` / `haikuTierRespect` when the
 *        client asked for that tier — candidate must be same tier.
 *      - subagent call: candidate's tier must be in
 *        `entry.subagentTiers` if that list is non-empty.
 *   3. Cached usage: `isExhausted(target)` returns true when the account
 *      is out of budget on any binding window.
 *   4. Recent error rate: `errorRate(target)` must be below the
 *      constraint's `errorRateSkipPct`; the check requires at least
 *      `minHealthSamples` recent samples (handled by the caller — this
 *      function trusts the callback).
 *
 * All-candidates-fail branches:
 *   - `constraints.exhaustedBehavior === '429'` → `primary: null`, caller
 *     is expected to return `rate_limit_error` with `Retry-After`.
 *   - `constraints.exhaustedBehavior === 'passthrough'` → `primary: null`
 *     and `fallbacks: []`, letting the caller keep the client's original
 *     model (L4 behaviour).
 */

import type { PreferenceConstraints, RequestedModelTier, RouterPreferenceEntry } from '@/schemas'
import { tierOf } from '../scenario-router/model-selection'

export interface PreferenceSelectorInput {
  entries: readonly RouterPreferenceEntry[]
  constraints: PreferenceConstraints
  requestedTier: RequestedModelTier | undefined
  isSubagent: boolean
  // Predicate: does this account/model have zero remaining budget on
  // any binding window? Callers back this with `getCachedUsagePct`
  // and/or the Phase 2d scheduler snapshot. Trusts the caller — this
  // module is pure.
  isExhausted: (target: string) => boolean
  // Recent error rate (0-1). Callers back with the Phase 2e
  // model-health tracker; Phase 2c can pass `() => 0`.
  errorRate: (target: string) => number
}

export interface PreferenceSelection {
  primary: string | null
  fallbacks: string[]
  // Whether the caller should skip the passthrough / 429 branch
  // because at least one candidate did pass every gate.
  matched: boolean
  // Machine-readable reasons per skipped candidate, in evaluation
  // order. Used by the shadow-mode divergence logger (Phase 2e) and
  // the utilization dashboard (later).
  skipped: { target: string; reason: SkipReason }[]
}

export type SkipReason = 'disabled' | 'tier_mismatch_agent' | 'tier_mismatch_subagent' | 'exhausted' | 'error_rate'

// Tier match for AGENT calls: the constraint knobs (sonnetTierRespect,
// haikuTierRespect) express "client asked for tier X, honour that or
// escalate to a higher tier?". Open Question 1 decision is strict:
// same-tier only when the respect flag is on. Client tiers other than
// sonnet/haiku (opus/fable) don't have a respect knob — those callers
// accept any tier so the preference author has full control.
const tierMatchesAgent = (
  candidateTier: RequestedModelTier | undefined,
  requestedTier: RequestedModelTier | undefined,
  constraints: PreferenceConstraints
): boolean => {
  if (requestedTier === 'sonnet' && constraints.sonnetTierRespect) return candidateTier === 'sonnet'
  if (requestedTier === 'haiku' && constraints.haikuTierRespect) return candidateTier === 'haiku'
  return true
}

// Tier match for SUBAGENT calls: the entry-level `subagentTiers`
// filter (Open Question 11 decision). Empty list = no restriction;
// non-empty = candidate must be in the list. The requested tier is
// ignored for subagent routing because the tag's PRESENCE selects the
// subagent route (its value is unused).
const tierMatchesSubagent = (candidateTier: RequestedModelTier | undefined, entry: RouterPreferenceEntry): boolean => {
  if (entry.subagentTiers.length === 0) return true
  if (candidateTier === undefined) return false
  return entry.subagentTiers.includes(candidateTier)
}

// Extract the model name from a "providerName,modelName" target so
// `tierOf` can classify it. Returns undefined for malformed targets,
// which the caller's tier check will treat as "unknown tier" (skipped
// in strict mode, allowed otherwise).
const modelNameOf = (target: string): string | undefined => {
  const parts = target.split(',')
  if (parts.length !== 2) return undefined
  if (parts[1].length === 0) return undefined
  return parts[1]
}

export function selectByPreference(input: PreferenceSelectorInput): PreferenceSelection {
  const passing: string[] = []
  const skipped: { target: string; reason: SkipReason }[] = []

  for (const entry of input.entries) {
    if (!entry.enabled) {
      skipped.push({ target: entry.target, reason: 'disabled' })
      continue
    }
    // Manual tier override (Model.manualTier) wins when present so
    // operators can classify third-party models that don't follow the
    // fable/opus/sonnet/haiku naming convention. Name inference is
    // the fallback for legacy targets that pre-date the override.
    const modelName = modelNameOf(entry.target)
    const inferredTier = modelName === undefined ? undefined : tierOf(modelName)
    const overrideTier =
      entry.resolvedTier === null || entry.resolvedTier === undefined ? undefined : entry.resolvedTier
    const candidateTier = overrideTier ?? inferredTier

    if (input.isSubagent) {
      if (!tierMatchesSubagent(candidateTier, entry)) {
        skipped.push({ target: entry.target, reason: 'tier_mismatch_subagent' })
        continue
      }
    } else if (!tierMatchesAgent(candidateTier, input.requestedTier, input.constraints)) {
      skipped.push({ target: entry.target, reason: 'tier_mismatch_agent' })
      continue
    }

    if (input.isExhausted(entry.target)) {
      skipped.push({ target: entry.target, reason: 'exhausted' })
      continue
    }

    if (input.errorRate(entry.target) >= input.constraints.errorRateSkipPct) {
      skipped.push({ target: entry.target, reason: 'error_rate' })
      continue
    }

    passing.push(entry.target)
  }

  if (passing.length === 0) {
    return { primary: null, fallbacks: [], matched: false, skipped }
  }
  const [primary, ...fallbacks] = passing
  return { primary, fallbacks, matched: true, skipped }
}
