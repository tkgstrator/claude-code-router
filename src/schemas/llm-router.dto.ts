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

export const ScenarioTypeSchema = z.enum(['default', 'background', 'think', 'longContext', 'webSearch'])
export type ScenarioType = z.infer<typeof ScenarioTypeSchema>

// Per-kind primary map: scenario -> "provider,model". Every scenario is
// optional so a partial override file is tolerated.
const RouteMapSchema = z.object({
  default: z.string().nonempty().optional(),
  background: z.string().nonempty().optional(),
  think: z.string().nonempty().optional(),
  longContext: z.string().nonempty().optional(),
  webSearch: z.string().nonempty().optional(),
  image: z.string().nonempty().optional()
})

// Per-kind fallback map: scenario -> ordered "provider,model" chain. A
// missing scenario is an empty chain, so each field defaults to [].
const FallbackMapSchema = z.object({
  default: z.array(z.string().nonempty()).default([]),
  background: z.array(z.string().nonempty()).default([]),
  think: z.array(z.string().nonempty()).default([]),
  longContext: z.array(z.string().nonempty()).default([]),
  webSearch: z.array(z.string().nonempty()).default([]),
  image: z.array(z.string().nonempty()).default([])
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
  /** Token threshold above which a request gets routed to longContext. */
  longContextThreshold: z.number().optional(),
  /**
   * Extra margin (percentage points) allowed over the weekly drain target
   * before the proactive failover guard trips. Router-wide policy knob.
   */
  weeklyDrainMarginPct: z.number().optional(),
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
