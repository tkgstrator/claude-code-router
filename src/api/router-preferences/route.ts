/**
 * GET/PUT a RouterPreferenceProfile, plus the list of profiles.
 *
 * Dedicated endpoints — NOT routed through /api/config —
 * so unknown preference keys can never leak onto disk via the envelope
 * catchall. Total-order replace on PUT; the service resolves
 * "providerName,modelName" targets to Model FKs and drops unknown ones
 * with warnings.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { RouterPreferenceProfileSchema } from '../../schemas'
import {
  applyRouterPreferences,
  DEFAULT_PROFILE_KEY,
  listPreferenceProfiles,
  loadRouterPreferences
} from '../../services/router-preference-service'

export const routerPreferencesRoute = new OpenAPIHono()

const ApplyResponseSchema = z
  .object({
    success: z.boolean(),
    warnings: z.array(z.string().nonempty()).default([])
  })
  .openapi('RouterPreferencesApplyResponse')

// Which profile the request addresses. Omitted means the default one,
// so every pre-existing caller keeps hitting the same row it always did.
const ProfileQuerySchema = z.object({
  profile: z.string().nonempty().default(DEFAULT_PROFILE_KEY)
})

const ProfileListSchema = z
  .object({
    profiles: z.array(
      z.object({
        key: z.string().nonempty(),
        entryCount: z.number().int().nonnegative(),
        updatedAt: z.string().nonempty().nullable()
      })
    )
  })
  .openapi('RouterPreferenceProfileList')

const listRoute = createRoute({
  method: 'get',
  path: '/api/router-preferences/profiles',
  responses: {
    200: {
      description: 'Every configured profile key; the default is always listed',
      content: { 'application/json': { schema: ProfileListSchema } }
    }
  }
})

routerPreferencesRoute.openapi(listRoute, async (c) => c.json({ profiles: await listPreferenceProfiles() }, 200))

const getRoute = createRoute({
  method: 'get',
  path: '/api/router-preferences',
  request: { query: ProfileQuerySchema },
  responses: {
    200: {
      description: 'Current preference chain (empty entries + null constraints on a fresh DB)',
      content: { 'application/json': { schema: RouterPreferenceProfileSchema } }
    }
  }
})

routerPreferencesRoute.openapi(getRoute, async (c) => {
  const { profile } = c.req.valid('query')
  return c.json(await loadRouterPreferences(undefined, profile), 200)
})

const putRoute = createRoute({
  method: 'put',
  path: '/api/router-preferences',
  request: {
    query: ProfileQuerySchema,
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
  const { profile } = c.req.valid('query')
  return c.json(await applyRouterPreferences(body, undefined, profile), 200)
})
