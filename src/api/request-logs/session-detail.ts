/**
 * Per-session detail routes: raw RequestLog rows (with computed cost)
 * and the archived chat message transcript.
 */

import { createRoute } from '@hono/zod-openapi'
import { getPrismaClient } from '../../db/client'
import { SessionIdParamSchema, SessionLogsResponseSchema, SessionMessagesResponseSchema } from '../../schemas'
import { buildPriceMap, computeCosts } from '../../services/cost-service'
import { requestLogsRoute } from './app'

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

// ── GET /api/request-logs/sessions/:sessionId/messages ───────────────────────
// Archived chat messages for a session, oldest-first so the client can render
// them top-to-bottom like a chat log. Populated by the pipeline hook that
// captures the last user block on request send and the assembled assistant
// blocks after the response stream completes.

const getSessionMessagesRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/sessions/:sessionId/messages',
  request: { params: SessionIdParamSchema },
  responses: {
    200: {
      description: 'Archived chat messages for the session, oldest first.',
      content: { 'application/json': { schema: SessionMessagesResponseSchema } }
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

requestLogsRoute.openapi(getSessionMessagesRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const prisma = getPrismaClient()
  const rows = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true }
  })
  const items = rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString()
  }))
  return c.json({ items }, 200)
})
