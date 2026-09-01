/**
 * The vendor subscription-usage endpoints, as they answer.
 *
 * Deliberately loose — every field is `unknown` and read defensively —
 * because these are undocumented side-channel endpoints that change
 * without notice. The normalised shape the app serves is api/usage.ts.
 */

import { z } from '@hono/zod-openapi'

// Wire schemas for upstream HTTP shapes (kept for the usage fetch only).
export const ClaudeUsageWireSchema = z.object({
  five_hour: z.unknown().optional(),
  seven_day: z.unknown().optional(),
  seven_day_sonnet: z.unknown().optional(),
  seven_day_opus: z.unknown().optional(),
  extra_usage: z.unknown().optional(),
  // Per-limit rows the API now emits alongside the flat windows. Contains
  // session / weekly_all / weekly_scoped entries; the weekly_scoped ones
  // carry a per-model breakdown (via `scope.model.display_name`) that the
  // deprecated flat fields no longer surface.
  limits: z.unknown().optional()
})

export const CodexUsageWireSchema = z.object({
  plan_type: z.unknown().optional(),
  rate_limit: z.unknown().optional()
})
