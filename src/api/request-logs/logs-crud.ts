/**
 * Flat request-log routes: paginated list plus delete-all / delete-one.
 */

import { createRoute } from '@hono/zod-openapi'
import { getPrismaClient } from '../../db/client'
import {
  RequestLogIdParamSchema,
  RequestLogsDeleteAllResponseSchema,
  RequestLogsDeleteOneResponseSchema,
  RequestLogsListQuerySchema,
  RequestLogsListResponseSchema
} from '../../schemas'
import { buildPriceMap, computeCosts } from '../../services/cost-service'
import { requestLogsRoute } from './app'

// ── GET /api/request-logs ─────────────────────────────────────────────────────

const getRequestLogsRoute = createRoute({
  method: 'get',
  path: '/api/request-logs',
  request: {
    query: RequestLogsListQuerySchema
  },
  responses: {
    200: {
      description: 'Paginated list of LLM request stats.',
      content: { 'application/json': { schema: RequestLogsListResponseSchema } }
    }
  }
})

requestLogsRoute.openapi(getRequestLogsRoute, async (c) => {
  const { limit, offset } = c.req.valid('query')
  const prisma = getPrismaClient()
  const [total, logs] = await Promise.all([
    prisma.requestLog.count(),
    prisma.requestLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit, skip: offset })
  ])
  const pairs = [...new Set(logs.map((l) => `${l.provider}||${l.model}`))]
  const priceMap = await buildPriceMap(prisma, pairs)
  const items = logs.map((log) => ({
    ...log,
    sessionId: log.sessionId,
    createdAt: log.createdAt.toISOString(),
    ...computeCosts(log, priceMap)
  }))
  return c.json({ items, total }, 200)
})

// ── DELETE /api/request-logs ──────────────────────────────────────────────────

requestLogsRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/api/request-logs',
    responses: {
      200: {
        description: 'All deleted.',
        content: { 'application/json': { schema: RequestLogsDeleteAllResponseSchema } }
      }
    }
  }),
  async (c) => {
    const prisma = getPrismaClient()
    // Delete all logs first (FK constraint), then sessions
    const { count } = await prisma.requestLog.deleteMany()
    await prisma.session.deleteMany()
    return c.json({ deleted: count }, 200)
  }
)

// ── DELETE /api/request-logs/:id ──────────────────────────────────────────────

requestLogsRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/api/request-logs/:id',
    request: { params: RequestLogIdParamSchema },
    responses: {
      200: {
        description: 'Deleted.',
        content: { 'application/json': { schema: RequestLogsDeleteOneResponseSchema } }
      }
    }
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    await getPrismaClient().requestLog.delete({ where: { id } })
    return c.json({ id }, 200)
  }
)
