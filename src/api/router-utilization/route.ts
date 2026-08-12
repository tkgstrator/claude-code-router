/**
 * Utilization dashboard API (Phase 7).
 *
 * Returns per-scenario / per-target / per-account snapshots plus the
 * detector-generated suggestions the UI cards render. Backed by
 * services/router-utilization-service.ts — the API layer only shapes
 * the response for the wire.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getRouterUtilization } from '../../services/router-utilization-service'

const PerScenarioRowSchema = z
  .object({
    scenario: z.string().nonempty(),
    total: z.number().int().min(0),
    ok: z.number().int().min(0),
    err429: z.number().int().min(0),
    errOther: z.number().int().min(0)
  })
  .openapi('RouterUtilizationPerScenarioRow')

const PerTargetRowSchema = z
  .object({
    requestedModel: z.string().nullable(),
    sentTo: z.string().nonempty(),
    count: z.number().int().min(0)
  })
  .openapi('RouterUtilizationPerTargetRow')

const PerAccountRowSchema = z
  .object({
    subAccountId: z.string().nonempty(),
    providerName: z.string().nonempty(),
    kind: z.enum(['claude', 'codex']),
    currentBudgetPct: z.number().min(0).max(100).nullable(),
    fiveHourResetAt: z.string().nullable(),
    weeklyResetAt: z.string().nullable(),
    stale: z.boolean()
  })
  .openapi('RouterUtilizationPerAccountRow')

const SuggestionSchema = z
  .object({
    kind: z.enum(['primary_never_reached', 'fallback_over_used', 'exhausted_no_secondary']),
    target: z.string().nonempty(),
    detail: z.string().nonempty(),
    proposedDiff: z.record(z.string().nonempty(), z.any())
  })
  .openapi('RouterUtilizationSuggestion')

const ResponseSchema = z
  .object({
    windowHours: z.number().int().positive(),
    generatedAt: z.string().nonempty(),
    perScenario: z.array(PerScenarioRowSchema),
    perTarget: z.array(PerTargetRowSchema),
    perAccount: z.array(PerAccountRowSchema),
    suggestions: z.array(SuggestionSchema)
  })
  .openapi('RouterUtilizationResponse')

export const routerUtilizationRoute = new OpenAPIHono()

const route = createRoute({
  method: 'get',
  path: '/api/router-utilization',
  request: {
    query: z.object({
      windowHours: z.coerce
        .number()
        .int()
        .positive()
        .max(24 * 30)
        .default(24)
    })
  },
  responses: {
    200: {
      description: 'Router traffic + budget utilization for the requested window',
      content: { 'application/json': { schema: ResponseSchema } }
    }
  }
})

routerUtilizationRoute.openapi(route, async (c) => {
  const { windowHours } = c.req.valid('query')
  const out = await getRouterUtilization(windowHours)
  return c.json(out, 200)
})
