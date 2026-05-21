import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { SubscriptionsResponseSchema } from '../../schemas'
import { syncSubAccountProfiles } from '../../services/subscription-account-sync-service'
import { getSubscriptionsInfo } from '../../services/subscription-info-service'

export const subscriptionsRoute = new OpenAPIHono()

const getSubscriptionsRoute = createRoute({
  method: 'get',
  path: '/api/subscriptions',
  responses: {
    200: {
      description: 'Subscription credentials info per provider',
      content: { 'application/json': { schema: SubscriptionsResponseSchema } }
    }
  }
})
subscriptionsRoute.openapi(getSubscriptionsRoute, async (c) => {
  const subscriptions = await getSubscriptionsInfo()
  return c.json({ subscriptions }, 200)
})

const syncSubscriptionsRoute = createRoute({
  method: 'post',
  path: '/api/subscriptions/sync',
  responses: {
    200: {
      description: 'Re-fetch profile data from upstream and return refreshed subscriptions',
      content: {
        'application/json': {
          schema: z.object({ updated: z.number(), failed: z.number() }).merge(SubscriptionsResponseSchema)
        }
      }
    }
  }
})
subscriptionsRoute.openapi(syncSubscriptionsRoute, async (c) => {
  const { updated, failed } = await syncSubAccountProfiles()
  const subscriptions = await getSubscriptionsInfo()
  return c.json({ updated, failed, subscriptions }, 200)
})
