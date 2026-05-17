import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
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

// The backend is a thin DB read; all chart shaping lives here.
interface UsageSample {
  metric: string
  percent: number
  t: string
}
interface HistoryResponse {
  samples: UsageSample[]
}

interface ConsumptionPoint {
  t: string
  v: number
}

// Per-metric burn rate: positive 5-min deltas (window resets drop the
// %, so negatives clamp to 0) summed over a trailing 1-hour window =
// "% of the window consumed in the last hour".
function hourlyConsumption(samples: UsageSample[], metric: string): ConsumptionPoint[] {
  const pts = samples.filter((s) => s.metric === metric).map((s) => ({ at: dayjs(s.t), pct: s.percent, t: s.t }))
  const deltas = pts.map((p, i) => (i === 0 ? 0 : Math.max(0, p.pct - pts[i - 1].pct)))
  return pts.map((p, i) => {
    const cutoff = p.at.subtract(1, 'hour')
    const v = deltas.slice(0, i + 1).reduce((acc, d, j) => (pts[j].at.isAfter(cutoff) ? acc + d : acc), 0)
    return { t: p.t, v: Math.round(v * 10) / 10 }
  })
}

interface MetricMeta {
  label: string
  color: string
}

// Stable color + readable label per known window metric.
const METRIC_META: Record<string, MetricMeta> = {
  'claude.five_hour': { label: 'Claude 5h', color: '#d97757' },
  'claude.seven_day': { label: 'Claude 7d', color: '#b35a3f' },
  'claude.seven_day_sonnet': { label: 'Claude 7d Sonnet', color: '#e6a08c' },
  'claude.seven_day_opus': { label: 'Claude 7d Opus', color: '#8c3d28' },
  'codex.primary': { label: 'Codex 5h', color: '#10a37f' },
  'codex.secondary': { label: 'Codex 7d', color: '#0a6f57' }
}

// Definite lookup with an explicit default — no nullish/or fallback.
function metaFor(metric: string): MetricMeta {
  const meta = METRIC_META[metric]
  if (meta) return meta
  return { label: metric, color: '#888888' }
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
      for (const p of hourlyConsumption(history.samples, m)) {
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
            <p className='text-sm text-gray-500'>{t('usage.claudeUnavailable')}</p>
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
            <p className='text-sm text-gray-500'>{t('usage.codexNoData')}</p>
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
                <YAxis tickLine={false} axisLine={false} unit='%/h' width={48} />
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
