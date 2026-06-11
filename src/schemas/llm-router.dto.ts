/**
 * Schemas for the scenario router.
 *
 * `ScenarioRouterConfig` is what each Router slot map looks like inside
 * the pipeline (string|undefined per scenario — distinct from the
 * UI-facing `RouterConfig` in router.dto.ts, which uses `string | null`
 * for explicitly-unset slots returned by /api/config).
 *
 * `ProjectRouterFile` is the on-disk shape of
 * `~/.claude-code-router/<project>/config.json` (or per-session
 * `<sessionId>.json`); parsing it through Zod replaces an unsafe cast
 * after JSON.parse.
 */

import { z } from '@hono/zod-openapi'

export const ScenarioTypeSchema = z.enum(['default', 'background', 'think', 'longContext', 'webSearch'])
export type ScenarioType = z.infer<typeof ScenarioTypeSchema>

export const ScenarioRouterConfigSchema = z.object({
  default: z.string().nonempty().optional(),
  background: z.string().nonempty().optional(),
  think: z.string().nonempty().optional(),
  longContext: z.string().nonempty().optional(),
  webSearch: z.string().nonempty().optional(),
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
