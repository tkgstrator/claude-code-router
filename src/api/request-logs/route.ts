import { createHash, timingSafeEqual } from 'node:crypto'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getPrismaClient } from '../../db/client'
import {
  RequestLogIdParamSchema,
  RequestLogsDeleteAllResponseSchema,
  RequestLogsDeleteOneResponseSchema,
  RequestLogsListQuerySchema,
  RequestLogsListResponseSchema,
  RequestLogsSessionsQuerySchema,
  SessionIdParamSchema,
  SessionLogsResponseSchema,
  SessionSummarySchema,
  SessionsResponseSchema
} from '../../schemas'
import { buildPriceMap, computeCosts } from '../../services/cost-service'
import { type RequestLogEvent, requestLogEmitter } from './events'

export const requestLogsRoute = new OpenAPIHono()

// ── GET /api/request-logs/sessions ───────────────────────────────────────────

const getSessionsRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/sessions',
  request: {
    query: RequestLogsSessionsQuerySchema
  },
  responses: {
    200: {
      description: 'LLM request sessions with aggregated stats.',
      content: {
        'application/json': { schema: SessionsResponseSchema }
      }
    }
  }
})

requestLogsRoute.openapi(getSessionsRoute, async (c) => {
  const { limit, offset } = c.req.valid('query')
  const prisma = getPrismaClient()

  // Sessions from the Session table (ordered by most-recently-updated first)
  const [total, sessionRows] = await Promise.all([
    prisma.session.count(),
    prisma.session.findMany({
      orderBy: { updatedAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        logs: {
          select: {
            provider: true,
            model: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheWriteTokens: true,
            totalInputTokens: true,
            cacheHitPct: true,
            durationMs: true,
            createdAt: true
          }
        }
      }
    })
  ])

  // Collect all provider+model pairs for a single price-map lookup
  const allPairs = [...new Set(sessionRows.flatMap((s) => s.logs.map((l) => `${l.provider}||${l.model}`)))]
  const priceMap = await buildPriceMap(prisma, allPairs)

  const sessions = sessionRows.map((s) => {
    const logs = s.logs
    const providers = [...new Set(logs.map((l) => l.provider))]
    const models = [...new Set(logs.map((l) => l.model))]
    const totalInputTokens = logs.reduce((a, l) => a + l.totalInputTokens, 0)
    const totalOutputTokens = logs.reduce((a, l) => a + l.outputTokens, 0)
    const totalCacheReadTokens = logs.reduce((a, l) => a + l.cacheReadTokens, 0)
    const totalCacheWriteTokens = logs.reduce((a, l) => a + l.cacheWriteTokens, 0)
    const totalDurationMs = logs.reduce((a, l) => a + l.durationMs, 0)
    const avgCacheHitPct = logs.length > 0 ? Math.round(logs.reduce((a, l) => a + l.cacheHitPct, 0) / logs.length) : 0
    const dates = logs.map((l) => l.createdAt.getTime())
    const firstAt = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : s.createdAt.toISOString()
    const lastAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : s.updatedAt.toISOString()

    // Aggregate cost across all logs in the session
    let totalCostUsd: number | null = null
    for (const log of logs) {
      const { totalCostUsd: c } = computeCosts(log, priceMap)
      if (c != null) totalCostUsd = (totalCostUsd ?? 0) + c
    }

    return {
      sessionId: s.id,
      requestCount: logs.length,
      providers,
      models,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      avgCacheHitPct,
      totalDurationMs,
      totalCostUsd,
      firstAt,
      lastAt
    }
  })

  return c.json({ sessions, total }, 200)
})

// ── GET /api/request-logs/sessions/:sessionId/summary ────────────────────────
// Returns the aggregated SessionSummary for a single session without loading
// all logs. Used by the SSE handler to patch the client list in-place.

const getSessionSummaryRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/sessions/:sessionId/summary',
  request: { params: SessionIdParamSchema },
  responses: {
    200: {
      description: 'Aggregated stats for a single session.',
      content: { 'application/json': { schema: SessionSummarySchema } }
    },
    404: { description: 'Session not found.' }
  }
})

requestLogsRoute.openapi(getSessionSummaryRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const prisma = getPrismaClient()

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      logs: {
        select: {
          provider: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          totalInputTokens: true,
          cacheHitPct: true,
          durationMs: true,
          createdAt: true
        }
      }
    }
  })

  if (!session) return c.json({ error: 'Not found' } as never, 404)

  const logs = session.logs
  const pairs = [...new Set(logs.map((l) => `${l.provider}||${l.model}`))]
  const priceMap = await buildPriceMap(prisma, pairs)

  const providers = [...new Set(logs.map((l) => l.provider))]
  const models = [...new Set(logs.map((l) => l.model))]
  const totalInputTokens = logs.reduce((a, l) => a + l.totalInputTokens, 0)
  const totalOutputTokens = logs.reduce((a, l) => a + l.outputTokens, 0)
  const totalCacheReadTokens = logs.reduce((a, l) => a + l.cacheReadTokens, 0)
  const totalCacheWriteTokens = logs.reduce((a, l) => a + l.cacheWriteTokens, 0)
  const totalDurationMs = logs.reduce((a, l) => a + l.durationMs, 0)
  const avgCacheHitPct = logs.length > 0 ? Math.round(logs.reduce((a, l) => a + l.cacheHitPct, 0) / logs.length) : 0
  const dates = logs.map((l) => l.createdAt.getTime())
  const firstAt = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : session.createdAt.toISOString()
  const lastAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : session.updatedAt.toISOString()

  let totalCostUsd: number | null = null
  for (const log of logs) {
    const { totalCostUsd: c } = computeCosts(log, priceMap)
    if (c != null) totalCostUsd = (totalCostUsd ?? 0) + c
  }

  return c.json(
    {
      sessionId,
      requestCount: logs.length,
      providers,
      models,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      avgCacheHitPct,
      totalDurationMs,
      totalCostUsd,
      firstAt,
      lastAt
    },
    200
  )
})

// ── GET /api/request-logs/sessions/:sessionId ─────────────────────────────────

const getSessionLogsRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/sessions/:sessionId',
  request: { params: SessionIdParamSchema },
  responses: {
    200: {
      description: 'All request logs for a specific session.',
      content: { 'application/json': { schema: SessionLogsResponseSchema } }
    }
  }
})

requestLogsRoute.openapi(getSessionLogsRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const prisma = getPrismaClient()
  const logs = await prisma.requestLog.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' }
  })
  const pairs = [...new Set(logs.map((l) => `${l.provider}||${l.model}`))]
  const priceMap = await buildPriceMap(prisma, pairs)
  const items = logs.map((log) => ({
    ...log,
    sessionId: log.sessionId,
    createdAt: log.createdAt.toISOString(),
    ...computeCosts(log, priceMap)
  }))
  return c.json({ items }, 200)
})

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

// ── GET /api/request-logs/events (SSE) ───────────────────────────────────────
// EventSource doesn't support custom headers, so the API key is accepted as
// the `apikey` query param in addition to the standard x-api-key header.

const digest = (s: string) => createHash('sha256').update(s).digest()

requestLogsRoute.get('/api/request-logs/events', (c) => {
  const expected = (process.env.APIKEY ?? '').trim()
  const provided = (c.req.query('apikey') ?? c.req.header('x-api-key') ?? '').trim()
  const ok = expected.length > 0 && provided.length > 0 && timingSafeEqual(digest(provided), digest(expected))
  if (!ok) {
    return c.json(
      { type: 'error', error: { type: 'authentication_error', message: 'Invalid or missing API key' } },
      401
    )
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: RequestLogEvent) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
      }
      requestLogEmitter.on('new_log', send)
      // Heartbeat every 30 s to keep the connection alive through proxies.
      const hb = setInterval(() => controller.enqueue(': heartbeat\n\n'), 30_000)
      c.req.raw.signal.addEventListener('abort', () => {
        requestLogEmitter.off('new_log', send)
        clearInterval(hb)
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
})
