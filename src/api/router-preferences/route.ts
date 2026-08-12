/**
 * GET/PUT the singleton RouterPreferenceProfile (Phase 2b).
 *
 * Dedicated endpoints — NOT routed through /api/config —
 * so unknown preference keys can never leak onto disk via the envelope
 * catchall. Total-order replace on PUT; the service resolves
 * "providerName,modelName" targets to Model FKs and drops unknown ones
 * with warnings.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { RouterPreferenceProfileSchema } from '../../schemas'
import { applyRouterPreferences, loadRouterPreferences } from '../../services/router-preference-service'

export const routerPreferencesRoute = new OpenAPIHono()

const ApplyResponseSchema = z
  .object({
    success: z.boolean(),
    warnings: z.array(z.string().nonempty()).default([])
  })
  .openapi('RouterPreferencesApplyResponse')

const getRoute = createRoute({
  method: 'get',
  path: '/api/router-preferences',
  responses: {
    200: {
      description: 'Current preference chain (empty entries + null constraints on a fresh DB)',
      content: { 'application/json': { schema: RouterPreferenceProfileSchema } }
    }
  }
})

routerPreferencesRoute.openapi(getRoute, async (c) => {
  const profile = await loadRouterPreferences()
  return c.json(profile, 200)
})

const putRoute = createRoute({
  method: 'put',
  path: '/api/router-preferences',
  request: {
    body: { content: { 'application/json': { schema: RouterPreferenceProfileSchema } } }
  },
  responses: {
    200: {
      description: 'Total-order replacement; unknown targets are dropped with warnings',
      content: { 'application/json': { schema: ApplyResponseSchema } }
    }
  }
})

routerPreferencesRoute.openapi(putRoute, async (c) => {
  const body = c.req.valid('json')
  const outcome = await applyRouterPreferences(body)
  return c.json(outcome, 200)
})
