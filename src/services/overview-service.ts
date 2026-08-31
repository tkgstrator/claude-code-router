/**
 * Aggregations for the Overview screen.
 *
 * One query pass over a bounded window of `RequestLog`, plus the current
 * quota snapshot and the recent scheduler weight changes. Everything the
 * screen shows comes from here so the page makes a single request instead
 * of fanning out to five endpoints and stitching them client-side.
 */

import { getPrismaClient } from '../db/client'
import dayjs from '../lib/dayjs'
import { buildPriceMap, computeCosts, type PriceEntry } from './cost-service'
import { listSurfaces } from './inbound-surface-service'

export interface SurfaceTrafficRow {
  id: string
  path: string
  client: string
  routingMode: 'routed' | 'passthrough'
  requests: number
  /** Median upstream duration in ms. Null when the surface saw no traffic. */
  p50Ms: number | null
  /** Share of requests with a non-2xx status, 0-1. Null when no traffic. */
  errorRate: number | null
}

export interface SpendRow {
  label: 'today' | 'week' | 'month' | 'savedBySubscription'
  usd: number | null
}

export interface QuotaRow {
  subAccountId: string
  account: string
  window: string
  pct: number
  resetAt: string | null
}

export interface FailoverRow {
  kind: 'rate_limit' | 'weight'
  tone: 'bad' | 'warn'
  label: string
  headline: string
  detail: string
  at: string
}

export interface RecentSessionRow {
  sessionId: string
  surface: string | null
  model: string
  turns: number
  tokens: number
  costUsd: number | null
  lastAt: string
}

export interface OverviewResponse {
  windowHours: number
  generatedAt: string
  providerCount: number
  enabledModelCount: number
  surfaces: SurfaceTrafficRow[]
  spend: SpendRow[]
  quota: QuotaRow[]
  failover: FailoverRow[]
  recentSessions: RecentSessionRow[]
}

// Exact median of an already-sorted list; averages the middle pair on an
// even count so a two-request surface does not report the slower one as
// its typical latency.
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

const priceKey = (provider: string, model: string): string => `${provider}||${model}`

function sumCost(
  logs: Array<{
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }>,
  priceMap: Map<string, PriceEntry>
): number | null {
  const priced = logs.map((l) => computeCosts(l, priceMap).totalCostUsd).filter((c): c is number => c !== null)
  if (priced.length === 0) return null
  return priced.reduce((a, b) => a + b, 0)
}

/**
 * Percent used for one quota window, or null when the collector has not
 * populated it. Guards against a zero limit, which upstream has been seen
 * to report while a window is being provisioned.
 */
function pct(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit <= 0) return null
  return Math.min(100, Math.round((used / limit) * 100))
}

type WindowLog = {
  sessionId: string
  surface: string | null
  provider: string
  model: string
  durationMs: number
  status: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalInputTokens: number
  createdAt: Date
}

type MonthLog = {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  createdAt: Date
}

type QuotaRecord = Awaited<ReturnType<typeof loadQuotas>>[number]
type WeightChange = { target: string; fromWeight: number; toWeight: number; reason: string; createdAt: Date }

// Group by an arbitrary key while preserving first-seen order, which the
// callers rely on: `windowLogs` arrives newest-first, so the first entry
// of each bucket is that session's most recent request.
function groupBy<T>(rows: T[], key: (row: T) => string | null): { order: string[]; buckets: Map<string, T[]> } {
  const order: string[] = []
  const buckets = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    if (k === null) continue
    const bucket = buckets.get(k)
    if (bucket === undefined) {
      order.push(k)
      buckets.set(k, [row])
    } else {
      bucket.push(row)
    }
  }
  return { order, buckets }
}

function buildSurfaces(configs: ResolvedSurfaceLike[], windowLogs: WindowLog[]): SurfaceTrafficRow[] {
  const { buckets } = groupBy(windowLogs, (l) => l.surface)
  return configs.map((surface) => {
    const bucket = buckets.get(surface.id)
    const rows = bucket === undefined ? [] : bucket
    const durations = rows.map((r) => r.durationMs).sort((a, b) => a - b)
    const errors = rows.filter((r) => r.status < 200 || r.status >= 300).length
    return {
      id: surface.id,
      path: surface.path,
      client: surface.client,
      routingMode: surface.routingMode,
      requests: rows.length,
      p50Ms: median(durations),
      errorRate: rows.length === 0 ? null : errors / rows.length
    }
  })
}

function buildSpend(monthLogs: MonthLog[], priceMap: Map<string, PriceEntry>): SpendRow[] {
  const dayStart = dayjs().startOf('day')
  const weekStart = dayjs().subtract(7, 'day')
  return [
    {
      label: 'today',
      usd: sumCost(
        monthLogs.filter((l) => dayjs(l.createdAt).isAfter(dayStart)),
        priceMap
      )
    },
    {
      label: 'week',
      usd: sumCost(
        monthLogs.filter((l) => dayjs(l.createdAt).isAfter(weekStart)),
        priceMap
      )
    },
    { label: 'month', usd: sumCost(monthLogs, priceMap) },
    // What the subscription seats absorbed: token cost that WOULD have
    // been billed had the same traffic gone to a metered provider.
    // Computing it needs a per-request "what would this have cost on the
    // cheapest metered equivalent" mapping that does not exist yet, so it
    // reports null rather than a confident $0.
    { label: 'savedBySubscription', usd: null }
  ]
}

const accountLabel = (q: QuotaRecord): string =>
  q.subAccount.label !== null ? q.subAccount.label : q.subAccount.provider.name

function buildQuota(quotas: QuotaRecord[]): QuotaRow[] {
  const windows: Array<{
    window: string
    used: (q: QuotaRecord) => number | null
    limit: (q: QuotaRecord) => number | null
    resetAt: (q: QuotaRecord) => Date | null
  }> = [
    { window: '5h', used: (q) => q.fiveHourUsed, limit: (q) => q.fiveHourLimit, resetAt: (q) => q.fiveHourResetAt },
    { window: '7d', used: (q) => q.weeklyUsed, limit: (q) => q.weeklyLimit, resetAt: (q) => q.weeklyResetAt }
  ]
  const out: QuotaRow[] = []
  for (const q of quotas) {
    for (const w of windows) {
      const percent = pct(w.used(q), w.limit(q))
      if (percent === null) continue
      const resetAt = w.resetAt(q)
      out.push({
        subAccountId: q.subAccountId,
        account: accountLabel(q),
        window: w.window,
        pct: percent,
        resetAt: resetAt === null ? null : resetAt.toISOString()
      })
    }
  }
  return out
}

function buildFailover(quotas: QuotaRecord[], weightChanges: WeightChange[]): FailoverRow[] {
  const rateLimited = quotas
    .filter((q) => q.lastRateLimitedAt !== null)
    .map(
      (q): FailoverRow => ({
        kind: 'rate_limit',
        tone: 'bad',
        label: q.lastRateLimitStatus === null ? '429' : String(q.lastRateLimitStatus),
        headline: `${accountLabel(q)} rate limited`,
        detail: q.lastRetryAfterSec === null ? 'no Retry-After on the response' : `Retry-After ${q.lastRetryAfterSec}s`,
        at: q.lastRateLimitedAt === null ? '' : q.lastRateLimitedAt.toISOString()
      })
    )

  const weights = weightChanges.map(
    (w): FailoverRow => ({
      kind: 'weight',
      tone: 'warn',
      label: 'weight',
      headline: `${w.target} ${w.fromWeight.toFixed(2)} → ${w.toWeight.toFixed(2)}`,
      detail: `reason: ${w.reason}`,
      at: w.createdAt.toISOString()
    })
  )

  return [...rateLimited, ...weights].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
}

function buildRecentSessions(windowLogs: WindowLog[], priceMap: Map<string, PriceEntry>): RecentSessionRow[] {
  const { order, buckets } = groupBy(windowLogs, (l) => l.sessionId)
  return order.slice(0, 8).map((sessionId) => {
    const bucket = buckets.get(sessionId)
    const rows = bucket === undefined ? [] : bucket
    const first = rows[0]
    return {
      sessionId,
      surface: first.surface,
      model: first.model,
      turns: rows.length,
      tokens: rows.reduce((sum, r) => sum + r.totalInputTokens + r.outputTokens, 0),
      costUsd: sumCost(rows, priceMap),
      lastAt: first.createdAt.toISOString()
    }
  })
}

// Narrower than ResolvedSurface so the builders stay testable without the
// DB-backed override lookup.
interface ResolvedSurfaceLike {
  id: string
  path: string
  client: string
  routingMode: 'routed' | 'passthrough'
}

function loadQuotas() {
  return getPrismaClient().subAccountQuota.findMany({
    include: { subAccount: { select: { id: true, label: true, plan: true, provider: { select: { name: true } } } } }
  })
}

export async function getOverview(windowHours: number): Promise<OverviewResponse> {
  const prisma = getPrismaClient()
  const since = dayjs().subtract(windowHours, 'hour').toDate()
  const monthStart = dayjs().subtract(30, 'day').toDate()

  const [surfaceConfigs, providerCount, enabledModelCount, windowLogs, monthLogs, quotas, weightChanges] =
    await Promise.all([
      listSurfaces(),
      prisma.provider.count(),
      prisma.model.count({ where: { enabled: true } }),
      prisma.requestLog.findMany({
        where: { createdAt: { gte: since } },
        select: {
          sessionId: true,
          surface: true,
          provider: true,
          model: true,
          durationMs: true,
          status: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          totalInputTokens: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.requestLog.findMany({
        where: { createdAt: { gte: monthStart } },
        select: {
          provider: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          createdAt: true
        }
      }),
      loadQuotas(),
      prisma.routingWeightChange.findMany({ orderBy: { createdAt: 'desc' }, take: 6 })
    ])

  const priceMap = await buildPriceMap(prisma, [...new Set(monthLogs.map((l) => priceKey(l.provider, l.model)))])

  return {
    windowHours,
    generatedAt: dayjs().toISOString(),
    providerCount,
    enabledModelCount,
    surfaces: buildSurfaces(surfaceConfigs, windowLogs),
    spend: buildSpend(monthLogs, priceMap),
    quota: buildQuota(quotas),
    failover: buildFailover(quotas, weightChanges),
    recentSessions: buildRecentSessions(windowLogs, priceMap)
  }
}
