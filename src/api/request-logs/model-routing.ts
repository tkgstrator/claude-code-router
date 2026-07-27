/**
 * Model-routing report: a cross-tab of what the client (Claude Code)
 * requested in body.model versus what CCR actually sent upstream.
 *
 * Groups request_logs by (requestedModel, provider, model, scenario) and
 * folds the counts into one row per requested model, so the UI can show
 * "claude-sonnet-4-5 → 98% anthropic/claude-sonnet-4-5, 2% openai/gpt-5".
 * Rows written before routing capture landed have a null requestedModel
 * and bucket into the "untracked" row.
 */

import { createRoute } from '@hono/zod-openapi'
import { getPrismaClient } from '../../db/client'
import dayjs from '../../lib/dayjs'
import { ModelRoutingQuerySchema, ModelRoutingResponseSchema } from '../../schemas'
import { requestLogsRoute } from './app'

const getModelRoutingRoute = createRoute({
  method: 'get',
  path: '/api/request-logs/model-routing',
  request: { query: ModelRoutingQuerySchema },
  responses: {
    200: {
      description: 'Requested-model → actual-target routing distribution.',
      content: { 'application/json': { schema: ModelRoutingResponseSchema } }
    }
  }
})

type Target = { provider: string; model: string; scenario: string | null; isSubagent: boolean; count: number }
type Row = { requestedModel: string | null; total: number; targets: Target[] }

requestLogsRoute.openapi(getModelRoutingRoute, async (c) => {
  const { sinceHours } = c.req.valid('query')
  const prisma = getPrismaClient()

  const since = sinceHours > 0 ? dayjs().subtract(sinceHours, 'hour').toDate() : null
  // Drop rows written before subagent tracking landed (isSubagent IS NULL);
  // the UI has no meaningful bucket for them and the caller already asked
  // to hide the untracked variant. Same reasoning applies to requestedModel
  // — a null there means the row predates routing capture too.
  const where = {
    ...(since ? { createdAt: { gte: since } } : {}),
    isSubagent: { not: null },
    requestedModel: { not: null }
  }

  const grouped = await prisma.requestLog.groupBy({
    by: ['requestedModel', 'provider', 'model', 'scenario', 'isSubagent'],
    where,
    _count: { _all: true }
  })

  // Fold the flat groups into one row per requested model. A Map keyed on
  // the requestedModel string (null is a valid Map key, so the untracked
  // bucket coexists with named rows) collects each requested model's
  // targets and running total.
  const byRequested = new Map<string | null, Row>()
  for (const g of grouped) {
    const count = g._count._all
    const existing = byRequested.get(g.requestedModel)
    const row: Row = existing ? existing : { requestedModel: g.requestedModel, total: 0, targets: [] }
    row.total += count
    row.targets.push({
      provider: g.provider,
      model: g.model,
      scenario: g.scenario,
      // The `isSubagent: { not: null }` filter above narrows the column
      // to a boolean at runtime; Prisma still types it as `boolean | null`.
      isSubagent: g.isSubagent === true,
      count
    })
    byRequested.set(g.requestedModel, row)
  }
  const grandTotal = grouped.reduce((sum, g) => sum + g._count._all, 0)

  // Most-used requested model first; within a row, most-used target first.
  const rows = [...byRequested.values()].sort((a, b) => b.total - a.total)
  for (const row of rows) row.targets.sort((a, b) => b.count - a.count)

  return c.json({ rows, total: grandTotal }, 200)
})
