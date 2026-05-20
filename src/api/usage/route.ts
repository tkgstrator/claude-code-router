import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { UsageResponseSchema } from '../../schemas'
import { fetchUsageSnapshot } from '../../services/usage-service'

export const usageRoute = new OpenAPIHono()

const getUsageRoute = createRoute({
  method: 'get',
  path: '/api/usage',
  responses: {
    200: {
      description:
        'Subscription usage: Claude from its official OAuth usage endpoint (live), Codex from the latest snapshot captured off real /v1 traffic.',
      content: { 'application/json': { schema: UsageResponseSchema } }
    }
  }
})

usageRoute.openapi(getUsageRoute, async (c) => {
  const { usage } = await fetchUsageSnapshot()
  return c.json(usage, 200)
})
