import { getPrismaClient } from '../db/client'
import dayjs from '../lib/dayjs'
import { getUsage } from './usage-service'

// Keep a bit more than the week the UI charts so the edges look full.
const RETAIN_DAYS = 8

interface SnapshotRow {
  provider: string
  metric: string
  percent: number
  resetAt: Date | null
}

const toDate = (iso: string | null): Date | null => {
  if (!iso) return null
  const d = dayjs(iso)
  return d.isValid() ? d.toDate() : null
}

// Flatten the live usage snapshot into one row per window, taking the
// maximum utilization across all accounts for that vendor so the chart
// reflects the most-constrained account.
const flatten = (u: Awaited<ReturnType<typeof getUsage>>): SnapshotRow[] => {
  const best = new Map<string, SnapshotRow>()
  const keep = (row: SnapshotRow) => {
    const prev = best.get(row.metric)
    if (!prev || row.percent > prev.percent) best.set(row.metric, row)
  }
  for (const c of u.claude) {
    if (c.fiveHour)
      keep({
        provider: 'claude',
        metric: 'claude.five_hour',
        percent: c.fiveHour.utilization,
        resetAt: toDate(c.fiveHour.resetsAt)
      })
    if (c.sevenDay)
      keep({
        provider: 'claude',
        metric: 'claude.seven_day',
        percent: c.sevenDay.utilization,
        resetAt: toDate(c.sevenDay.resetsAt)
      })
    if (c.sevenDaySonnet)
      keep({
        provider: 'claude',
        metric: 'claude.seven_day_sonnet',
        percent: c.sevenDaySonnet.utilization,
        resetAt: toDate(c.sevenDaySonnet.resetsAt)
      })
    if (c.sevenDayOpus)
      keep({
        provider: 'claude',
        metric: 'claude.seven_day_opus',
        percent: c.sevenDayOpus.utilization,
        resetAt: toDate(c.sevenDayOpus.resetsAt)
      })
  }
  for (const x of u.codex) {
    if (x.primary)
      keep({
        provider: 'codex',
        metric: 'codex.primary',
        percent: x.primary.usedPercent,
        resetAt: toDate(x.primary.resetAt)
      })
    if (x.secondary)
      keep({
        provider: 'codex',
        metric: 'codex.secondary',
        percent: x.secondary.usedPercent,
        resetAt: toDate(x.secondary.resetAt)
      })
  }
  return [...best.values()]
}

export async function recordUsageSnapshots(): Promise<void> {
  const rows = flatten(await getUsage())
  if (rows.length === 0) return
  // Snap to the 5-min mark (BullMQ fires the job on the same grid via
  // cron */5) so every capture lands on a clean :00/:05/:10 boundary
  // and one capture's rows share an identical pivot timestamp.
  const capturedAt = dayjs().floor('minute', 5).toDate()
  await getPrismaClient().usageSnapshot.createMany({
    data: rows.map((r) => ({ ...r, capturedAt }))
  })
}

export async function pruneOldSnapshots(): Promise<void> {
  await getPrismaClient().usageSnapshot.deleteMany({
    where: { capturedAt: { lt: dayjs().subtract(RETAIN_DAYS, 'day').toDate() } }
  })
}

// One raw snapshot row. The backend stays a thin DB read — every
// chart-shaping decision (deltas, reset clamping, moving average,
// line vs bar) lives in the frontend.
export interface UsageSample {
  metric: string
  percent: number
  t: string
  resetAt: string | null
}

export interface UsageHistory {
  samples: UsageSample[]
}

export async function getUsageHistory(days: number): Promise<UsageHistory> {
  const since = dayjs().subtract(days, 'day').toDate()
  const rows = await getPrismaClient().usageSnapshot.findMany({
    where: { capturedAt: { gte: since }, metric: { not: { contains: ':' } } },
    orderBy: { capturedAt: 'asc' },
    select: { metric: true, percent: true, capturedAt: true, resetAt: true }
  })
  return {
    samples: rows.map((r) => ({
      metric: r.metric,
      percent: r.percent,
      t: dayjs(r.capturedAt).toISOString(),
      resetAt: r.resetAt ? dayjs(r.resetAt).toISOString() : null
    }))
  }
}
