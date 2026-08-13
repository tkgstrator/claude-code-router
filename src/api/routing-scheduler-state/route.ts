/**
 * Read-only routing scheduler snapshot (Phase 5).
 *
 * Returns whatever the last scheduler tick published — current weight
 * per preference target, per-account quota state, soonest reset time,
 * and the bounded ring of recent weight changes. Cold-boot returns an
 * empty snapshot rather than 404 so the UI can render "no data yet"
 * without a special code path.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import dayjs from '../../lib/dayjs'
import { getRecentWeightChanges, getRoutingSnapshot } from '../../services/routing-scheduler'

const WeightEntryDtoSchema = z
  .object({
    target: z.string().nonempty(),
    weight: z.number().min(0).max(1),
    healthiness: z.number().min(0),
    remainingBudgetPct: z.number().nullable(),
    earliestResetAt: z.string().nullable(),
    reasons: z.array(z.string().nonempty())
  })
  .openapi('RoutingWeightEntry')

const QuotaWindowDtoSchema = z
  .object({
    used: z.number(),
    limit: z.number(),
    resetAt: z.string().nullable()
  })
  .openapi('RoutingQuotaWindow')

const AccountQuotaViewDtoSchema = z
  .object({
    subAccountId: z.string().nonempty(),
    providerName: z.string().nonempty(),
    kind: z.enum(['claude', 'codex']),
    fiveHour: QuotaWindowDtoSchema.nullable(),
    weekly: QuotaWindowDtoSchema.nullable(),
    refreshedAt: z.string().nullable(),
    stale: z.boolean()
  })
  .openapi('RoutingAccountQuotaView')

const WeightChangeDtoSchema = z
  .object({
    target: z.string().nonempty(),
    from: z.number(),
    to: z.number(),
    reason: z.string().nonempty(),
    tickAt: z.string().nonempty()
  })
  .openapi('RoutingWeightChange')

const SchedulerStateResponseSchema = z
  .object({
    tickAt: z.string().nullable(),
    tickCount: z.number().int().min(0),
    consecutiveFailures: z.number().int().min(0),
    degraded: z.boolean(),
    weights: z.array(WeightEntryDtoSchema),
    accounts: z.array(AccountQuotaViewDtoSchema),
    soonestResetAt: z.string().nullable(),
    recentChanges: z.array(WeightChangeDtoSchema)
  })
  .openapi('RoutingSchedulerStateResponse')

const isoOrNull = (ms: number | null): string | null => (ms === null ? null : dayjs(ms).toISOString())

export const routingSchedulerStateRoute = new OpenAPIHono()

const getRoute = createRoute({
  method: 'get',
  path: '/api/routing-scheduler-state',
  responses: {
    200: {
      description: 'Current routing snapshot plus the recent weight-change ring',
      content: { 'application/json': { schema: SchedulerStateResponseSchema } }
    }
  }
})

routingSchedulerStateRoute.openapi(getRoute, async (c) => {
  const snap = getRoutingSnapshot()
  if (snap === null) {
    return c.json(
      {
        tickAt: null,
        tickCount: 0,
        consecutiveFailures: 0,
        degraded: false,
        weights: [],
        accounts: [],
        soonestResetAt: null,
        recentChanges: []
      },
      200
    )
  }
  return c.json(
    {
      tickAt: dayjs(snap.tickAt).toISOString(),
      tickCount: snap.tickCount,
      consecutiveFailures: snap.consecutiveFailures,
      degraded: snap.degraded,
      weights: [...snap.weights.values()].map((w) => ({
        target: w.target,
        weight: w.weight,
        healthiness: w.healthiness,
        remainingBudgetPct: w.remainingBudgetPct,
        earliestResetAt: isoOrNull(w.earliestResetAt),
        reasons: [...w.reasons]
      })),
      accounts: snap.accounts.map((a) => ({
        subAccountId: a.subAccountId,
        providerName: a.providerName,
        kind: a.kind,
        fiveHour:
          a.fiveHour === null
            ? null
            : { used: a.fiveHour.used, limit: a.fiveHour.limit, resetAt: isoOrNull(a.fiveHour.resetAt) },
        weekly:
          a.weekly === null
            ? null
            : { used: a.weekly.used, limit: a.weekly.limit, resetAt: isoOrNull(a.weekly.resetAt) },
        refreshedAt: isoOrNull(a.refreshedAt),
        stale: a.stale
      })),
      soonestResetAt: isoOrNull(snap.soonestResetAt),
      recentChanges: getRecentWeightChanges().map((ch) => ({
        target: ch.target,
        from: ch.from,
        to: ch.to,
        reason: ch.reason,
        tickAt: dayjs(ch.tickAt).toISOString()
      }))
    },
    200
  )
})
