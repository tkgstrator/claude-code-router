import { getPrismaClient } from '../db/client'
import dayjs from '../lib/dayjs'
import { recordPerAccountUsage, scopedMetricKey } from './subaccount-usage-store'
import { fetchUsageSnapshotWithAccountIds, type getUsage } from './usage-service'

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
// When multiple accounts share the same metric (e.g. two Claude Max
// subscriptions), average their utilization so the chart reflects
// combined capacity usage rather than just the most-constrained account.
// resetAt is taken from the account whose quota resets soonest.
const flatten = (u: Awaited<ReturnType<typeof getUsage>>): SnapshotRow[] => {
  const acc = new Map<string, { provider: string; sumPercent: number; count: number; resetAt: Date | null }>()

  const add = (provider: string, metric: string, percent: number, resetAt: Date | null) => {
    const prev = acc.get(metric)
    if (!prev) {
      acc.set(metric, { provider, sumPercent: percent, count: 1, resetAt })
    } else {
      const earliest =
        prev.resetAt === null
          ? resetAt
          : resetAt === null
            ? prev.resetAt
            : resetAt < prev.resetAt
              ? resetAt
              : prev.resetAt
      acc.set(metric, { provider, sumPercent: prev.sumPercent + percent, count: prev.count + 1, resetAt: earliest })
    }
  }

  for (const c of u.claude) {
    if (c.fiveHour) add('claude', 'claude.five_hour', c.fiveHour.utilization, toDate(c.fiveHour.resetsAt))
    if (c.sevenDay) add('claude', 'claude.seven_day', c.sevenDay.utilization, toDate(c.sevenDay.resetsAt))
    if (c.sevenDaySonnet)
      add('claude', 'claude.seven_day_sonnet', c.sevenDaySonnet.utilization, toDate(c.sevenDaySonnet.resetsAt))
    if (c.sevenDayOpus)
      add('claude', 'claude.seven_day_opus', c.sevenDayOpus.utilization, toDate(c.sevenDayOpus.resetsAt))
    for (const scoped of c.weeklyScoped) {
      add('claude', scopedMetricKey(scoped.modelName), scoped.utilization, toDate(scoped.resetsAt))
    }
  }
  for (const x of u.codex) {
    if (x.primary) add('codex', 'codex.primary', x.primary.usedPercent, toDate(x.primary.resetAt))
    if (x.secondary) add('codex', 'codex.secondary', x.secondary.usedPercent, toDate(x.secondary.resetAt))
  }

  return [...acc.entries()].map(([metric, { provider, sumPercent, count, resetAt }]) => ({
    provider,
    metric,
    percent: sumPercent / count,
    resetAt
  }))
}

export async function recordUsageSnapshots(): Promise<void> {
  // Pull once with subAccountId pairing so we can feed both the
  // aggregated history table and the per-account state table without
  // a second network round-trip to the upstream usage APIs.
  const paired = await fetchUsageSnapshotWithAccountIds()
  const usage = { claude: paired.claude.map((p) => p.usage), codex: paired.codex.map((p) => p.usage) }
  const rows = flatten(usage)
  if (rows.length > 0) {
    // Snap to the 5-min mark (BullMQ fires the job on the same grid via
    // cron */5) so every capture lands on a clean :00/:05/:10 boundary
    // and one capture's rows share an identical pivot timestamp.
    const capturedAt = dayjs().floor('minute', 5).toDate()
    await getPrismaClient().usageSnapshot.createMany({
      data: rows.map((r) => ({ ...r, capturedAt }))
    })
  }
  // Per-account current state — the router reads this on every routing
  // decision to skip accounts whose 7d / 5h window is at 100% with
  // resetAt still in the future.
  await recordPerAccountUsage(paired.claude, paired.codex)
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
