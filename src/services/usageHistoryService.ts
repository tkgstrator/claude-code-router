import { getPrismaClient } from '../db/client'
import dayjs from '../lib/dayjs'
import { getUsage } from './usageService'

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

// A chart row: the capture time plus one numeric column per metric.
// Returned ready for recharts so the frontend renders it verbatim —
// no client-side pivot, no missing-key fallbacks.
export type UsageHistoryRow = { t: string } & Record<string, number | string>

export interface UsageHistory {
  metrics: string[]
  rows: UsageHistoryRow[]
}

// Window length per metric (the rolling-limit period). Used to derive
// the linear allocation pace: 0% at window start -> 100% at reset.
const FIVE_HOURS_S = 5 * 3600
const SEVEN_DAYS_S = 7 * 86_400
const WINDOW_SECONDS: Record<string, number> = {
  'claude.five_hour': FIVE_HOURS_S,
  'claude.seven_day': SEVEN_DAYS_S,
  'claude.seven_day_sonnet': SEVEN_DAYS_S,
  'claude.seven_day_opus': SEVEN_DAYS_S,
  'codex.primary': FIVE_HOURS_S,
  'codex.secondary': SEVEN_DAYS_S
}

// % a perfectly-even burn would be at, given how far `capturedAt` is
// into the window that ends at `resetAt`. Staying under this means the
// current pace won't exhaust the window before it resets. Returns null
// when we can't place it (no resetAt / unknown window).
const paceAt = (metric: string, capturedAt: Date, resetAt: Date | null): number | null => {
  if (!resetAt) return null
  const windowS = WINDOW_SECONDS[metric]
  if (!windowS) return null
  const elapsedS = windowS - dayjs(resetAt).diff(dayjs(capturedAt), 'second', true)
  const pct = (elapsedS / windowS) * 100
  return Math.round(Math.min(100, Math.max(0, pct)))
}

export async function getUsageHistory(days: number): Promise<UsageHistory> {
  const since = dayjs().subtract(days, 'day').toDate()
  const samples = await getPrismaClient().usageSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: 'asc' },
    select: { metric: true, percent: true, resetAt: true, capturedAt: true }
  })

  const metricSet = new Set<string>()
  const byTime = new Map<string, UsageHistoryRow>()
  for (const s of samples) {
    metricSet.add(s.metric)
    const t = s.capturedAt.toISOString()
    const pace = paceAt(s.metric, s.capturedAt, s.resetAt)
    const existing = byTime.get(t)
    const row = existing ? existing : { t }
    row[s.metric] = s.percent
    if (pace !== null) row[`${s.metric}__pace`] = pace
    byTime.set(t, row)
  }
  return { metrics: [...metricSet].sort(), rows: [...byTime.values()] }
}
