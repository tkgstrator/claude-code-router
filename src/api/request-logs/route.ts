import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getPrismaClient } from '../../db/client'

export const requestLogsRoute = new OpenAPIHono()

// ── shared helpers ────────────────────────────────────────────────────────────

type PriceEntry = { inputPer1M: number | null; outputPer1M: number | null; cachedInputPer1M: number | null }

async function buildPriceMap(prisma: ReturnType<typeof getPrismaClient>, pairs: string[]) {
  if (pairs.length === 0) return new Map<string, PriceEntry>()

  const modelNames = [...new Set(pairs.map((p) => p.slice(p.indexOf('||') + 2)))]

  // Fetch all rows matching the provider+model pairs, plus any api_key-priced
  // rows for the same model names (fallback for subscription providers).
  const rows = await prisma.model.findMany({
    where: {
      OR: [
        ...pairs.map((p) => {
          const sep = p.indexOf('||')
          return { name: p.slice(sep + 2), provider: { name: p.slice(0, sep) } }
        }),
        { name: { in: modelNames }, inputPer1M: { not: null } }
      ]
    },
    select: {
      name: true,
      inputPer1M: true,
      outputPer1M: true,
      cachedInputPer1M: true,
      provider: { select: { name: true } }
    }
  })

  // Build map keyed by provider||model. Also build a fallback map keyed by
  // model name alone (first priced row wins) for subscription providers.
  const map = new Map<string, PriceEntry>()
  const fallback = new Map<string, PriceEntry>()
  for (const m of rows) {
    map.set(`${m.provider.name}||${m.name}`, m)
    if (m.inputPer1M != null && !fallback.has(m.name)) fallback.set(m.name, m)
  }

  // Inject fallback entries for pairs that have no price (missing or null)
  for (const pair of pairs) {
    const existing = map.get(pair)
    if (!existing || existing.inputPer1M == null) {
      const modelName = pair.slice(pair.indexOf('||') + 2)
      const fb = fallback.get(modelName)
      if (fb) map.set(pair, fb)
    }
  }

  return map
}

function computeCosts(
  log: {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  },
  priceMap: Map<string, { inputPer1M: number | null; outputPer1M: number | null; cachedInputPer1M: number | null }>
) {
  const price = priceMap.get(`${log.provider}||${log.model}`)
  const inputCostUsd = price?.inputPer1M != null ? (log.inputTokens / 1_000_000) * price.inputPer1M : null
  const outputCostUsd = price?.outputPer1M != null ? (log.outputTokens / 1_000_000) * price.outputPer1M : null
  const cacheReadCostUsd =
    price?.cachedInputPer1M != null ? (log.cacheReadTokens / 1_000_000) * price.cachedInputPer1M : null
  const cacheWriteCostUsd =
    price?.inputPer1M != null ? (log.cacheWriteTokens / 1_000_000) * price.inputPer1M * 1.25 : null
  const totalCostUsd =
    inputCostUsd != null && outputCostUsd != null
      ? inputCostUsd + outputCostUsd + (cacheReadCostUsd ?? 0) + (cacheWriteCostUsd ?? 0)
      : null
  return { inputCostUsd, outputCostUsd, cacheReadCostUsd, totalCostUsd }
}

// ── GET /api/request-logs/sessions ───────────────────────────────────────────

const SessionSummarySchema = z.object({
  sessionId: z.string().nonempty(),
  requestCount: z.number(),
  providers: z.array(z.string().nonempty()),
  models: z.array(z.string().nonempty()),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalCacheReadTokens: z.number(),
  totalCacheWriteTokens: z.number(),
  avgCacheHitPct: z.number(),
  totalDurationMs: z.number(),
  totalCostUsd: z.number().nullable(),
  firstAt: z.string().nonempty(),
  lastAt: z.string().nonempty()
})

const getSessionsRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/sessions',
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0)
    })
  },
  responses: {
    200: {
      description: 'LLM request sessions with aggregated stats.',
      content: {
        'application/json': { schema: z.object({ sessions: z.array(SessionSummarySchema), total: z.number() }) }
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

// ── GET /api/request-logs/sessions/:sessionId ─────────────────────────────────

const RequestLogItemSchema = z.object({
  id: z.string().nonempty(),
  sessionId: z.string().nonempty(),
  provider: z.string().nonempty(),
  model: z.string().nonempty(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalInputTokens: z.number(),
  cacheHitPct: z.number(),
  durationMs: z.number(),
  status: z.number(),
  createdAt: z.string().nonempty(),
  inputCostUsd: z.number().nullable(),
  outputCostUsd: z.number().nullable(),
  cacheReadCostUsd: z.number().nullable(),
  totalCostUsd: z.number().nullable()
})

const getSessionLogsRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/sessions/:sessionId',
  request: { params: z.object({ sessionId: z.string().nonempty() }) },
  responses: {
    200: {
      description: 'All request logs for a specific session.',
      content: { 'application/json': { schema: z.object({ items: z.array(RequestLogItemSchema) }) } }
    }
  }
})

requestLogsRoute.openapi(getSessionLogsRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const prisma = getPrismaClient()
  const logs = await prisma.requestLog.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' }
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
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).default(200),
      offset: z.coerce.number().int().min(0).default(0)
    })
  },
  responses: {
    200: {
      description: 'Paginated list of LLM request stats.',
      content: { 'application/json': { schema: z.object({ items: z.array(RequestLogItemSchema), total: z.number() }) } }
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
        content: { 'application/json': { schema: z.object({ deleted: z.number() }) } }
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
    request: { params: z.object({ id: z.string().nonempty() }) },
    responses: {
      200: { description: 'Deleted.', content: { 'application/json': { schema: z.object({ id: z.string().nonempty() }) } } }
    }
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    await getPrismaClient().requestLog.delete({ where: { id } })
    return c.json({ id }, 200)
  }
)
