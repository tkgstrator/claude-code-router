import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
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

const CAP_PCT = 200
const SMOOTH_N = 6
const RESET_DROP_RATIO = 0.5

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
  return raw.map((r, i) => {
    const win = raw.slice(Math.max(0, i - SMOOTH_N + 1), i + 1)
    return { t: r.t, v: Math.round((win.reduce((acc, w) => acc + w.p, 0) / win.length) * 10) / 10 }
  })
}

interface MetricMeta {
  label: string
  color: string
  windowHours: number
}

const METRIC_META: Record<string, MetricMeta> = {
  'claude.five_hour': { label: 'Claude 5h', color: '#d97757', windowHours: 5 },
  'claude.seven_day': { label: 'Claude 7d', color: '#b35a3f', windowHours: 168 },
  'claude.seven_day_sonnet': { label: 'Claude 7d Sonnet', color: '#e6a08c', windowHours: 168 },
  'claude.seven_day_opus': { label: 'Claude 7d Opus', color: '#8c3d28', windowHours: 168 },
  'codex.primary': { label: 'Codex 5h', color: '#10a37f', windowHours: 5 },
  'codex.secondary': { label: 'Codex 7d', color: '#0a6f57', windowHours: 168 }
}

function metaFor(metric: string): MetricMeta {
  return METRIC_META[metric] ?? { label: metric, color: '#888888', windowHours: 0 }
}

interface ModelCost {
  model: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCostUsd: number | null
}
interface ProviderCost {
  provider: string
  models: ModelCost[]
  totalCostUsd: number | null
  isSubscription: boolean
  subscriptionMonthlyUsd: number | null
}
interface UsageCostResponse {
  providers: ProviderCost[]
  days: number
}

const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

const fmtCost = (usd: number | null, noPricingLabel: string): string => {
  if (usd === null) return noPricingLabel
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function Usage() {
  const { t } = useTranslation()
  const [history, setHistory] = useState<HistoryResponse>({ samples: [] })
  const [costData, setCostData] = useState<UsageCostResponse | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [costDays, setCostDays] = useState(30)

  useEffect(() => {
    const refresh = () => {
      api
        .get<HistoryResponse>('/usage/history?days=7')
        .then(setHistory)
        .catch(() => setHistory({ samples: [] }))
    }
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    setCostLoading(true)
    api
      .get<UsageCostResponse>(`/usage/cost?days=${costDays}`)
      .then((d) => {
        setCostData(d)
        setCostLoading(false)
      })
      .catch(() => {
        setCostData({ providers: [], days: costDays })
        setCostLoading(false)
      })
  }, [costDays])

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
    const ticks = rows.map((r) => String(r.t)).filter((iso) => dayjs(iso).minute() % 10 === 0)
    return { rows, metrics, config, ticks }
  }, [history])

  return (
    <PageContainer>
      <PageHeader title={t('usage.title')} />
      <PageContent className='space-y-6'>
        <section className='space-y-3'>
          <div className='flex items-center justify-between'>
            <h3 className='text-sm font-semibold'>{t('usage.apiCost')}</h3>
            <div className='flex gap-1'>
              {([7, 30, 0] as const).map((d) => (
                <Button
                  key={d}
                  variant={costDays === d ? 'default' : 'ghost'}
                  size='sm'
                  className='h-6 px-2 text-xs'
                  onClick={() => setCostDays(d)}
                >
                  {d === 7
                    ? t('usage.apiCostPeriod7d')
                    : d === 30
                      ? t('usage.apiCostPeriod30d')
                      : t('usage.apiCostPeriodAll')}
                </Button>
              ))}
            </div>
          </div>
          {costData === null ? (
            <p className='text-sm text-muted-foreground'>…</p>
          ) : costData.providers.length === 0 ? (
            <p className='text-sm text-muted-foreground'>{t('usage.apiCostEmpty')}</p>
          ) : (
            <div
              className={`space-y-3 transition-opacity duration-150 ${costLoading ? 'pointer-events-none opacity-50' : ''}`}
            >
              {costData.providers.map((p) => (
                <div key={p.provider} className='rounded-md border'>
                  <div className='flex items-center justify-between border-b px-4 py-2'>
                    <span className='text-sm font-medium'>{p.provider}</span>
                    <span className='text-sm font-medium'>{fmtCost(p.totalCostUsd, t('usage.apiCostNoPricing'))}</span>
                  </div>
                  <table className='w-full text-xs'>
                    <tbody>
                      {p.models.map((m) => (
                        <tr key={m.model} className='border-b last:border-0'>
                          <td className='px-4 py-2 font-mono text-muted-foreground'>{m.model}</td>
                          <td className='whitespace-nowrap px-2 py-2 text-right text-muted-foreground'>
                            {m.requestCount.toLocaleString()} {t('usage.apiCostRequests')}
                          </td>
                          <td className='whitespace-nowrap px-2 py-2 text-right text-muted-foreground'>
                            ↑{fmtTokens(m.inputTokens + m.cacheWriteTokens)} ↓{fmtTokens(m.outputTokens)}
                          </td>
                          <td className='whitespace-nowrap px-4 py-2 text-right font-medium'>
                            {fmtCost(m.totalCostUsd, t('usage.apiCostNoPricing'))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
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
      </PageContent>
    </PageContainer>
  )
}
