import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { SubscriptionsResponseSchema } from '../../schemas'
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
