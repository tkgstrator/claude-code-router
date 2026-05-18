import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'

const REFRESH_MS = 5 * 60_000

// Subscription credentials come from the vendor CLI login, not a form
// in this UI; when nothing is connected yet we point the user at the
// vendor's own subscription page rather than showing an error.
const CLAUDE_SUBSCRIBE_URL = 'https://claude.ai'
const CODEX_SUBSCRIBE_URL = 'https://chatgpt.com'

// The backend is a thin DB read; all chart shaping lives here.
interface UsageSample {
  metric: string
  percent: number
  t: string
  resetAt: string | null
}
interface HistoryResponse {
  samples: UsageSample[]
}

interface SeriesPoint {
  t: string
  v: number
}

// Display cap. Aggressive early usage extrapolates to a huge number;
// clamp the line here so the axis stays readable — anything pinned at
// the cap just reads as "well past sustainable".
const CAP_PCT = 200

// Trailing sample count for the smoothing pass below (~30 min at the
// 5-min capture cadence). Count-based by request; it does blend across
// capture gaps (a long outage averages points from either side).
const SMOOTH_N = 6

// A reset is the counter refilling: it drops below this fraction of its
// prior value. Loose enough to catch every real reset in the data
// (15->1, 99->1, 40->3, 29->2) yet immune to ±1 vendor jitter.
const RESET_DROP_RATIO = 0.5

// Projected utilization at the window's next reset, from the average
// pace since the window last reset: pct * C / elapsed (C = cycle
// length). 100% = exactly exhausted at reset, >100% = locked out
// before it resets, <100% = headroom.
//
// `elapsed` is the LONGER of two estimates: time since the last
// detected refill (counter dropping past RESET_DROP_RATIO of its prior
// value) and the resetAt-implied window age (C - hoursToReset). Taking
// the max makes it robust to both vendor quirks: Codex reports two
// different windows under codex.secondary and switches between them
// (pct steps down with no real refill — a spurious short anchor that
// the resetAt age overrides), while codex.primary's 5h window is
// rolling so its resetAt slides every sample and C - hoursToReset
// reads ~0 (would pin at the cap unless the refill anchor floors it).
// elapsed is capped at C. At the exact reset sample elapsed is 0 (no pace yet),
// so we just show the actual pct there — no special boundary value;
// the formula resumes once a little time has elapsed. A trailing
// SMOOTH_N-sample average evens out the reactive early-cycle values
// and the integer-pct staircase.
function projectedUsage(samples: UsageSample[], metric: string): SeriesPoint[] {
  const cycle = metaFor(metric).windowHours
  let lastResetT: ReturnType<typeof dayjs> | null = null
  let prevPct: number | null = null
  const raw = samples
    .filter((s) => s.metric === metric)
    .map((s) => {
      const at = dayjs(s.t)
      if (prevPct !== null && s.percent < prevPct * RESET_DROP_RATIO) lastResetT = at
      prevPct = s.percent
      const fromDrop = lastResetT ? at.diff(lastResetT, 'hour', true) : null
      const fromReset = s.resetAt ? cycle - Math.max(0, dayjs(s.resetAt).diff(at, 'hour', true)) : null
      const elapsedRaw =
        fromDrop !== null && fromReset !== null
          ? Math.max(fromDrop, fromReset)
          : fromDrop !== null
            ? fromDrop
            : fromReset !== null
              ? fromReset
              : Number.NaN
      if (cycle <= 0 || !Number.isFinite(elapsedRaw)) return { t: s.t, p: Math.min(CAP_PCT, Math.max(0, s.percent)) }
      const elapsed = Math.min(cycle, elapsedRaw)
      const projected = elapsed > 0 ? (s.percent * cycle) / elapsed : s.percent
      return { t: s.t, p: Math.min(CAP_PCT, Math.max(0, projected)) }
    })
  // Plain trailing N-sample moving average of the projected value.
  return raw.map((r, i) => {
    const win = raw.slice(Math.max(0, i - SMOOTH_N + 1), i + 1)
    return { t: r.t, v: Math.round((win.reduce((acc, w) => acc + w.p, 0) / win.length) * 10) / 10 }
  })
}

interface MetricMeta {
  label: string
  color: string
  // Reset cadence in hours (5h vs 7d window). Needed to turn the next
  // resetAt into elapsed-since-last-reset for the average-pace projection.
  windowHours: number
}

// Stable color + readable label per known window metric.
const METRIC_META: Record<string, MetricMeta> = {
  'claude.five_hour': { label: 'Claude 5h', color: '#d97757', windowHours: 5 },
  'claude.seven_day': { label: 'Claude 7d', color: '#b35a3f', windowHours: 168 },
  'claude.seven_day_sonnet': { label: 'Claude 7d Sonnet', color: '#e6a08c', windowHours: 168 },
  'claude.seven_day_opus': { label: 'Claude 7d Opus', color: '#8c3d28', windowHours: 168 },
  'codex.primary': { label: 'Codex 5h', color: '#10a37f', windowHours: 5 },
  'codex.secondary': { label: 'Codex 7d', color: '#0a6f57', windowHours: 168 }
}

// Definite lookup with an explicit default — no nullish/or fallback.
function metaFor(metric: string): MetricMeta {
  const meta = METRIC_META[metric]
  if (meta) return meta
  return { label: metric, color: '#888888', windowHours: 0 }
}

interface ClaudeWindow {
  utilization: number
  resetsAt: string | null
}
interface CodexWindow {
  usedPercent: number
  resetAt: string | null
  windowSeconds: number | null
}
interface UsageResponse {
  claude: {
    fiveHour: ClaudeWindow | null
    sevenDay: ClaudeWindow | null
    sevenDaySonnet: ClaudeWindow | null
    sevenDayOpus: ClaudeWindow | null
    extraUsageEnabled: boolean
    capturedAt: string
  } | null
  codex: {
    planType: string | null
    primary: CodexWindow | null
    secondary: CodexWindow | null
    capturedAt: string
  } | null
}

const fmtReset = (iso: string | null): string => {
  if (!iso) return '—'
  const d = dayjs(iso)
  return d.isValid() ? d.format('YYYY/MM/DD HH:mm') : iso
}

function UsageBar({ label, percent, reset }: { label: string; percent: number; reset: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between text-sm'>
        <span className='font-medium'>{label}</span>
        <span className='text-gray-500'>{percent.toFixed(1)}%</span>
      </div>
      <div className='h-2 w-full overflow-hidden rounded-full bg-gray-200'>
        <div className='h-full rounded-full bg-primary' style={{ width: `${clamped}%` }} />
      </div>
      <div className='text-xs text-gray-500'>{reset}</div>
    </div>
  )
}

// Soft "not connected yet" state for a subscription section: a muted
// explanation plus a link to the vendor's subscription page. This is a
// normal state (the operator simply has not logged in with the vendor
// CLI), so it must not read like an error.
function NotRegistered({ message, hint, href, cta }: { message: string; hint: string; href: string; cta: string }) {
  return (
    <div className='space-y-1 text-sm text-gray-500'>
      <p>{message}</p>
      <p className='text-xs'>{hint}</p>
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='inline-block text-xs font-medium text-primary hover:underline'
      >
        {cta}
      </a>
    </div>
  )
}

export function Usage() {
  const { t } = useTranslation()
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState(false)
  const [history, setHistory] = useState<HistoryResponse>({ samples: [] })

  useEffect(() => {
    const refresh = () => {
      api
        .get<UsageResponse>('/usage')
        .then(setData)
        .catch(() => setError(true))
      api
        .get<HistoryResponse>('/usage/history?days=7')
        .then(setHistory)
        .catch(() => setHistory({ samples: [] }))
    }
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // All metrics on one chart: each metric's hourly-consumption series
  // merged into shared rows keyed by capture time. Recomputed only
  // when a fetch replaces history.
  const { rows, metrics, config, ticks } = useMemo(() => {
    const metrics = [...new Set(history.samples.map((s) => s.metric))].sort()
    const byT = new Map<string, Record<string, number | string>>()
    for (const m of metrics) {
      for (const p of projectedUsage(history.samples, m)) {
        const existing = byT.get(p.t)
        const row = existing ? existing : { t: p.t }
        row[m] = p.v
        byT.set(p.t, row)
      }
    }
    const config: ChartConfig = {}
    for (const m of metrics) {
      const meta = metaFor(m)
      config[m] = { label: meta.label, color: meta.color }
    }
    const rows = [...byT.values()].sort((a, b) => (String(a.t) < String(b.t) ? -1 : 1))
    // Only clean 10-min marks are tick candidates, so the axis shows
    // 10:00 / 10:10 / 10:20 … and never a stray 10:18.
    const ticks = rows.map((r) => String(r.t)).filter((iso) => dayjs(iso).minute() % 10 === 0)
    return { rows, metrics, config, ticks }
  }, [history])

  return (
    <Card className='flex h-full flex-col border-0 bg-white shadow-none'>
      <CardHeader className='border-b px-6 py-4'>
        <CardTitle className='text-lg'>{t('usage.title')}</CardTitle>
      </CardHeader>
      <CardContent className='flex-grow space-y-6 overflow-y-auto px-6 py-4'>
        {error && <div className='text-sm text-red-500'>{t('usage.loadError')}</div>}

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('usage.claude')}</h3>
          {!data?.claude ? (
            <NotRegistered
              message={t('usage.claudeNotRegistered')}
              hint={t('usage.notRegisteredHint', { cli: 'claude' })}
              href={CLAUDE_SUBSCRIBE_URL}
              cta={t('usage.openSubscriptionPage')}
            />
          ) : (
            <div className='space-y-4'>
              {data.claude.fiveHour && (
                <UsageBar
                  label={t('usage.fiveHour')}
                  percent={data.claude.fiveHour.utilization}
                  reset={`${t('usage.resets')}: ${fmtReset(data.claude.fiveHour.resetsAt)}`}
                />
              )}
              {data.claude.sevenDay && (
                <UsageBar
                  label={t('usage.sevenDay')}
                  percent={data.claude.sevenDay.utilization}
                  reset={`${t('usage.resets')}: ${fmtReset(data.claude.sevenDay.resetsAt)}`}
                />
              )}
              {data.claude.sevenDaySonnet && (
                <UsageBar
                  label={t('usage.sevenDaySonnet')}
                  percent={data.claude.sevenDaySonnet.utilization}
                  reset={`${t('usage.resets')}: ${fmtReset(data.claude.sevenDaySonnet.resetsAt)}`}
                />
              )}
              {data.claude.sevenDayOpus && (
                <UsageBar
                  label={t('usage.sevenDayOpus')}
                  percent={data.claude.sevenDayOpus.utilization}
                  reset={`${t('usage.resets')}: ${fmtReset(data.claude.sevenDayOpus.resetsAt)}`}
                />
              )}
              <div className='text-xs text-gray-500'>
                {t('usage.capturedAt')}: {fmtReset(data.claude.capturedAt)}
              </div>
            </div>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('usage.codex')}</h3>
          {!data?.codex ? (
            <NotRegistered
              message={t('usage.codexNotRegistered')}
              hint={t('usage.notRegisteredHint', { cli: 'codex' })}
              href={CODEX_SUBSCRIBE_URL}
              cta={t('usage.openSubscriptionPage')}
            />
          ) : (
            <div className='space-y-4'>
              {data.codex.primary && (
                <UsageBar
                  label={t('usage.primary')}
                  percent={data.codex.primary.usedPercent}
                  reset={`${t('usage.resets')}: ${fmtReset(data.codex.primary.resetAt)}`}
                />
              )}
              {data.codex.secondary && (
                <UsageBar
                  label={t('usage.secondary')}
                  percent={data.codex.secondary.usedPercent}
                  reset={`${t('usage.resets')}: ${fmtReset(data.codex.secondary.resetAt)}`}
                />
              )}
              <div className='text-xs text-gray-500'>
                {t('usage.capturedAt')}: {fmtReset(data.codex.capturedAt)}
              </div>
            </div>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('usage.history')}</h3>
          {rows.length === 0 ? (
            <p className='text-sm text-muted-foreground'>{t('usage.historyEmpty')}</p>
          ) : (
            <ChartContainer config={config} className='aspect-auto h-72 w-full'>
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey='t'
                  ticks={ticks}
                  tickFormatter={(val) => dayjs(String(val)).format('HH:mm')}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  unit='%'
                  domain={[0, CAP_PCT]}
                  ticks={[0, 50, 100, 150, 200]}
                />
                <ReferenceLine y={100} stroke='#ef4444' strokeDasharray='4 4' />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={(l) => dayjs(String(l)).format('M/D HH:mm')} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                {metrics.map((m) => (
                  <Line
                    key={m}
                    type='monotone'
                    dataKey={m}
                    stroke={metaFor(m).color}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
