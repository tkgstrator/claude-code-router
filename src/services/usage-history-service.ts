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

// Flatten the live usage snapshot into one row per account-window. Each
// account gets its own metric key ("claude.five_hour:AccountLabel") so the
// chart can draw a separate line per account. The `:label` suffix is omitted
// only when accountLabel is empty (should not happen in practice).
const flatten = (u: Awaited<ReturnType<typeof getUsage>>): SnapshotRow[] => {
  const rows: SnapshotRow[] = []
  const seen = new Set<string>()
  const push = (row: SnapshotRow) => {
    if (!seen.has(row.metric)) {
      seen.add(row.metric)
      rows.push(row)
    }
  }
  for (const c of u.claude) {
    const sfx = c.accountLabel ? `:${c.accountLabel}` : ''
    if (c.fiveHour)
      push({
        provider: 'claude',
        metric: `claude.five_hour${sfx}`,
        percent: c.fiveHour.utilization,
        resetAt: toDate(c.fiveHour.resetsAt)
      })
    if (c.sevenDay)
      push({
        provider: 'claude',
        metric: `claude.seven_day${sfx}`,
        percent: c.sevenDay.utilization,
        resetAt: toDate(c.sevenDay.resetsAt)
      })
    if (c.sevenDaySonnet)
      push({
        provider: 'claude',
        metric: `claude.seven_day_sonnet${sfx}`,
        percent: c.sevenDaySonnet.utilization,
        resetAt: toDate(c.sevenDaySonnet.resetsAt)
      })
    if (c.sevenDayOpus)
      push({
        provider: 'claude',
        metric: `claude.seven_day_opus${sfx}`,
        percent: c.sevenDayOpus.utilization,
        resetAt: toDate(c.sevenDayOpus.resetsAt)
      })
  }
  for (const x of u.codex) {
    const sfx = x.accountLabel ? `:${x.accountLabel}` : ''
    if (x.primary)
      push({
        provider: 'codex',
        metric: `codex.primary${sfx}`,
        percent: x.primary.usedPercent,
        resetAt: toDate(x.primary.resetAt)
      })
    if (x.secondary)
      push({
        provider: 'codex',
        metric: `codex.secondary${sfx}`,
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
    where: { capturedAt: { gte: since } },
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
