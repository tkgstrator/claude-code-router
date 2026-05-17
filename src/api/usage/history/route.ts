import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { UsageHistoryResponseSchema } from '../../../schemas'
import { getUsageHistory } from '../../../services/usageHistoryService'

export const usageHistoryRoute = new OpenAPIHono()

const getUsageHistoryRoute = createRoute({
  method: 'get',
  path: '/api/usage/history',
  request: {
    query: z.object({
      days: z.coerce.number().int().min(1).max(30).default(7)
    })
  },
  responses: {
    200: {
      description: 'Captured subscription utilization over the requested window (default 7 days).',
      content: { 'application/json': { schema: UsageHistoryResponseSchema } }
    }
  }
})

usageHistoryRoute.openapi(getUsageHistoryRoute, async (c) => {
  const { days } = c.req.valid('query')
  const history = await getUsageHistory(days)
  return c.json(history, 200)
})
