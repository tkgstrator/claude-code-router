import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { UsageHistoryQuerySchema, UsageHistoryResponseSchema } from '../../../schemas'
import { getUsageHistory } from '../../../services/usage-history-service'

export const usageHistoryRoute = new OpenAPIHono()

const getUsageHistoryRoute = createRoute({
  method: 'get',
  path: '/api/usage/history',
  request: {
    query: UsageHistoryQuerySchema
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
