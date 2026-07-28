/**
 * Schemas for the scenario router.
 *
 * `ScenarioRouterConfig` is the flat runtime shape the pipeline reads:
 * two per-kind primary maps (`agent` / `subagent`), two per-kind fallback
 * maps (`agentFallbacks` / `subagentFallbacks`), and the scalar knobs.
 * It mirrors `FlatRouter` (router.dto.ts) — composeUiConfig emits the
 * nested `RouterConfig`, context.ts flattens it to this before the
 * pipeline reads it. Every field is optional so a per-project override
 * file may carry only the slice it wants (absent → empty routes).
 *
 * `ProjectRouterFile` is the on-disk shape of
 * `~/.claude-code-router/<project>/config.json` (or per-session
 * `<sessionId>.json`); parsing it through Zod replaces an unsafe cast
 * after JSON.parse.
 */

import { z } from '@hono/zod-openapi'

// `background` was folded into a rule on `default` (predicate:
// requestedModel matches haiku) and no longer classifies as its own
// scenario at runtime.
export const ScenarioTypeSchema = z.enum(['default', 'think', 'longContext', 'webSearch'])
export type ScenarioType = z.infer<typeof ScenarioTypeSchema>

// Per-kind primary map: scenario -> "provider,model". Every scenario is
// optional so a partial override file is tolerated.
const RouteMapSchema = z.object({
  default: z.string().nonempty().optional(),
  think: z.string().nonempty().optional(),
  longContext: z.string().nonempty().optional(),
  webSearch: z.string().nonempty().optional(),
  image: z.string().nonempty().optional()
})

// Per-kind fallback map: scenario -> ordered "provider,model" chain. A
// missing scenario is an empty chain, so each field defaults to [].
const FallbackMapSchema = z.object({
  default: z.array(z.string().nonempty()).default([]),
  think: z.array(z.string().nonempty()).default([]),
  longContext: z.array(z.string().nonempty()).default([]),
  webSearch: z.array(z.string().nonempty()).default([]),
  image: z.array(z.string().nonempty()).default([])
})

// Per-kind rule stack: scenario -> ordered rule list. Every scenario is
// optional so a partial override file is tolerated; the runtime
// evaluator treats absent as an empty list. Rule shape is opaque here
// (JSON) — the runtime pipes it through RouteRuleSchema.parse before
// use so a malformed entry is dropped rather than crashing routing.
const RulesMapSchema = z.object({
  default: z.array(z.unknown()).default([]),
  think: z.array(z.unknown()).default([]),
  longContext: z.array(z.unknown()).default([]),
  webSearch: z.array(z.unknown()).default([]),
  image: z.array(z.unknown()).default([])
})

export const ScenarioRouterConfigSchema = z.object({
  /** Agent-route primaries keyed by scenario (main-agent traffic). */
  agent: RouteMapSchema.optional(),
  /** Subagent-route primaries keyed by scenario (<CCR-SUBAGENT-MODEL> tag present). */
  subagent: RouteMapSchema.optional(),
  /** Agent-route fallback chains keyed by scenario. */
  agentFallbacks: FallbackMapSchema.optional(),
  /** Subagent-route fallback chains keyed by scenario. */
  subagentFallbacks: FallbackMapSchema.optional(),
  /** Agent-route predicated rule stacks keyed by scenario. */
  agentRules: RulesMapSchema.optional(),
  /** Subagent-route predicated rule stacks keyed by scenario. */
  subagentRules: RulesMapSchema.optional(),
  /** Token threshold above which a request gets routed to longContext. */
  longContextThreshold: z.number().optional(),
  /**
   * Name of the active persona for this router (looked up in the
   * top-level Personas library). Optional so an existing per-project /
   * session override file without a persona still parses; absent / empty
   * means "no persona".
   */
  persona: z.string().nonempty().optional()
})
export type ScenarioRouterConfig = z.infer<typeof ScenarioRouterConfigSchema>

export const ProjectRouterFileSchema = z.object({
  Router: ScenarioRouterConfigSchema.optional()
})
export type ProjectRouterFile = z.infer<typeof ProjectRouterFileSchema>
