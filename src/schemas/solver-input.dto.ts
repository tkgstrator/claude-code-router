/**
 * Solver input schema (offline IP-solver Phase A — data collection only).
 *
 * The `SolverInput` object is the pure input a future
 * `javascript-lp-solver` phase will consume to produce optimised
 * routing parameters (chain weight overrides, threshold suggestions,
 * enabled/disabled flips). Phase A ships the data pipeline: nothing
 * here builds an LP formulation — the planner just observes.
 *
 * Every optional/missing value is normalised to `null` (not undefined)
 * so the wire shape is stable across scenarios / targets / accounts.
 */

import { z } from '@hono/zod-openapi'
import { ScenarioKeySchema } from './router.dto'

// Per-scenario aggregate traffic snapshot for the observation window.
// Percentile is PERCENTILE_CONT(0.95) over inputTokens (see
// collect-input.ts SQL). Counts split ok / 429 / other-error so the
// solver can weight scenarios by both volume and stress.
export const SolverInputScenarioSchema = z
  .object({
    scenario: ScenarioKeySchema,
    requestCount: z.number().int().nonnegative(),
    avgInputTokens: z.number().nonnegative(),
    p95InputTokens: z.number().nonnegative(),
    totalOutputTokens: z.number().nonnegative(),
    err429Count: z.number().int().nonnegative(),
    errOtherCount: z.number().int().nonnegative()
  })
  .openapi('SolverInputScenario')
export type SolverInputScenario = z.infer<typeof SolverInputScenarioSchema>

// Per-target chain membership. A target may participate in several
// scenarios at different priorities; each membership is emitted as a
// separate row so the solver can reason per-scenario.
export const SolverInputChainMembershipSchema = z
  .object({
    scenario: ScenarioKeySchema,
    priority: z.number().int().positive(),
    enabled: z.boolean(),
    subagentTiers: z.array(z.string().nonempty())
  })
  .openapi('SolverInputChainMembership')
export type SolverInputChainMembership = z.infer<typeof SolverInputChainMembershipSchema>

// Observed traffic on this target over the window. Counts + token
// totals mirror what RequestLog aggregates by (provider, model). Kept
// distinct from `scenarios` because a single target can carry traffic
// from multiple scenarios and the solver's per-target cost math wants
// the target-level totals.
export const SolverInputTargetObservedSchema = z
  .object({
    requestCount: z.number().int().nonnegative(),
    totalInputTokens: z.number().nonnegative(),
    totalOutputTokens: z.number().nonnegative(),
    err429Count: z.number().int().nonnegative()
  })
  .openapi('SolverInputTargetObserved')
export type SolverInputTargetObserved = z.infer<typeof SolverInputTargetObservedSchema>

// One row per (provider, model) target the planner may reason about.
// `target` is the canonical "provider,model" string the rest of the
// system speaks. Prices + contextWindow are pulled from the Model row
// so the solver knows the shape of each lane. `chainMemberships`
// captures the current preference-chain wiring so the solver can
// suggest edits relative to what's already configured.
export const SolverInputTargetSchema = z
  .object({
    target: z.string().nonempty(),
    provider: z.string().nonempty(),
    model: z.string().nonempty(),
    contextWindow: z.number().int().nullable(),
    inputPer1M: z.number().nullable(),
    outputPer1M: z.number().nullable(),
    chainMemberships: z.array(SolverInputChainMembershipSchema),
    observed: SolverInputTargetObservedSchema
  })
  .openapi('SolverInputTarget')
export type SolverInputTarget = z.infer<typeof SolverInputTargetSchema>

// One subscription-quota window snapshot. Mirrors the SubAccountQuota
// columns after normalisation: `used`/`limit` are pct-based today (see
// schema comment on SubAccountQuota) and `windowLengthMs` is the fixed
// or upstream-reported window length. All timestamps are ISO strings.
export const SolverInputQuotaWindowSchema = z
  .object({
    used: z.number(),
    limit: z.number(),
    resetAt: z.iso.datetime().nullable(),
    windowLengthMs: z.number().int().nullable()
  })
  .openapi('SolverInputQuotaWindow')
export type SolverInputQuotaWindow = z.infer<typeof SolverInputQuotaWindowSchema>

// One row per subscription SubAccount. Non-subscription providers are
// excluded upstream in the collector — api_key providers have no
// per-window budget the solver could plan against.
export const SolverInputAccountSchema = z
  .object({
    subAccountId: z.string().nonempty(),
    providerName: z.string().nonempty(),
    kind: z.enum(['claude', 'codex']),
    fiveHour: SolverInputQuotaWindowSchema.nullable(),
    weekly: SolverInputQuotaWindowSchema.nullable(),
    refreshedAt: z.iso.datetime().nullable()
  })
  .openapi('SolverInputAccount')
export type SolverInputAccount = z.infer<typeof SolverInputAccountSchema>

export const SolverInputSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    windowHours: z.number().int().positive(),
    scenarios: z.array(SolverInputScenarioSchema),
    targets: z.array(SolverInputTargetSchema),
    accounts: z.array(SolverInputAccountSchema)
  })
  .openapi('SolverInput')
export type SolverInput = z.infer<typeof SolverInputSchema>
