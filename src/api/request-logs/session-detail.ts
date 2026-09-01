/**
 * Per-session detail routes: raw RequestLog rows (with computed cost)
 * and the archived chat message transcript.
 */

import { createRoute } from '@hono/zod-openapi'
import { getPrismaClient } from '../../db/client'
import {
  SessionIdParamSchema,
  SessionLogsResponseSchema,
  SessionMessagesQuerySchema,
  SessionMessagesResponseSchema
} from '../../schemas/api/request-log'
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
// Archived chat messages for a session. Cursor-paginated newest-first from
// the server's view but returned in ascending order so the client can render
// them top-to-bottom like a chat log. The client fetches the newest window
// first (no `before`), then requests older windows by passing the id of the
// oldest message currently in view. Populated by the pipeline hook that
// captures the last user block on request send and the assembled assistant
// blocks after the response stream completes.

const getSessionMessagesRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/sessions/:sessionId/messages',
  request: { params: SessionIdParamSchema, query: SessionMessagesQuerySchema },
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
  const { limit, before } = c.req.valid('query')
  const prisma = getPrismaClient()

  // Descending walk from the newest end so pagination is anchored to the
  // most recent activity — matches how the client mounts the view (bottom
  // of the chat) and scrolls upward for history.
  // Composite (createdAt, id) order makes the cursor stable when two rows
  // share a timestamp.
  const rows = await prisma.message.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    take: limit + 1,
    select: { id: true, role: true, content: true, createdAt: true }
  })

  const hasMoreOlder = rows.length > limit
  const page = hasMoreOlder ? rows.slice(0, limit) : rows
  // Reverse to ascending so the client can render top-to-bottom.
  const items = [...page].reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString()
  }))
  const nextCursor = hasMoreOlder && items.length > 0 ? items[0].id : null
  return c.json({ items, nextCursor }, 200)
})
