import { getPrismaClient } from '../db/client'
import { getUsage } from './usageService'

// Keep a bit more than the week the UI charts so the edges look full.
const RETAIN_MS = 8 * 86_400_000

interface SnapshotRow {
  provider: string
  metric: string
  percent: number
  resetAt: Date | null
}

const toDate = (iso: string | null): Date | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

// Flatten the live usage snapshot into one row per window.
const flatten = (u: Awaited<ReturnType<typeof getUsage>>): SnapshotRow[] => {
  const rows: SnapshotRow[] = []
  const c = u.claude
  if (c) {
    if (c.fiveHour)
      rows.push({
        provider: 'claude',
        metric: 'claude.five_hour',
        percent: c.fiveHour.utilization,
        resetAt: toDate(c.fiveHour.resetsAt)
      })
    if (c.sevenDay)
      rows.push({
        provider: 'claude',
        metric: 'claude.seven_day',
        percent: c.sevenDay.utilization,
        resetAt: toDate(c.sevenDay.resetsAt)
      })
    if (c.sevenDaySonnet)
      rows.push({
        provider: 'claude',
        metric: 'claude.seven_day_sonnet',
        percent: c.sevenDaySonnet.utilization,
        resetAt: toDate(c.sevenDaySonnet.resetsAt)
      })
    if (c.sevenDayOpus)
      rows.push({
        provider: 'claude',
        metric: 'claude.seven_day_opus',
        percent: c.sevenDayOpus.utilization,
        resetAt: toDate(c.sevenDayOpus.resetsAt)
      })
  }
  const x = u.codex
  if (x) {
    if (x.primary)
      rows.push({
        provider: 'codex',
        metric: 'codex.primary',
        percent: x.primary.usedPercent,
        resetAt: toDate(x.primary.resetAt)
      })
    if (x.secondary)
      rows.push({
        provider: 'codex',
        metric: 'codex.secondary',
        percent: x.secondary.usedPercent,
        resetAt: toDate(x.secondary.resetAt)
      })
  }
  return rows
}

export async function recordUsageSnapshots(): Promise<void> {
  const rows = flatten(await getUsage())
  if (rows.length === 0) return
  await getPrismaClient().usageSnapshot.createMany({ data: rows })
}

export async function pruneOldSnapshots(): Promise<void> {
  await getPrismaClient().usageSnapshot.deleteMany({
    where: { capturedAt: { lt: new Date(Date.now() - RETAIN_MS) } }
  })
}

// A chart row: the capture time plus one numeric column per metric.
// Returned ready for recharts so the frontend renders it verbatim —
// no client-side pivot, no missing-key fallbacks.
export type UsageHistoryRow = { t: string } & Record<string, number | string>

export interface UsageHistory {
  metrics: string[]
  rows: UsageHistoryRow[]
}

export async function getUsageHistory(days: number): Promise<UsageHistory> {
  const since = new Date(Date.now() - days * 86_400_000)
  const samples = await getPrismaClient().usageSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: 'asc' },
    select: { metric: true, percent: true, capturedAt: true }
  })

  const metricSet = new Set<string>()
  const byTime = new Map<string, UsageHistoryRow>()
  for (const s of samples) {
    metricSet.add(s.metric)
    const t = s.capturedAt.toISOString()
    const existing = byTime.get(t)
    if (existing) {
      existing[s.metric] = s.percent
    } else {
      byTime.set(t, { t, [s.metric]: s.percent })
    }
  }
  return { metrics: [...metricSet].sort(), rows: [...byTime.values()] }
}
