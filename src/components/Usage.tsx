import { useEffect, useState } from 'react'
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

const REFRESH_MS = 5 * 60_000

// Backend returns chart-ready rows ({ t, <metric>: percent }) plus the
// metric list — no client pivot, no missing-key handling.
interface HistoryResponse {
  metrics: string[]
  rows: Record<string, number | string>[]
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
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
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
  const [history, setHistory] = useState<HistoryResponse>({ metrics: [], rows: [] })

  useEffect(() => {
    const refresh = () => {
      api
        .get<UsageResponse>('/usage')
        .then(setData)
        .catch(() => setError(true))
      api
        .get<HistoryResponse>('/usage/history?days=7')
        .then(setHistory)
        .catch(() => setHistory({ metrics: [], rows: [] }))
    }
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const { rows, metrics } = history
  const chartConfig: ChartConfig = {}
  for (const m of metrics) {
    const meta = metaFor(m)
    chartConfig[m] = { label: meta.label, color: meta.color }
    chartConfig[`${m}__pace`] = { label: `${meta.label} (pace)`, color: meta.color }
  }

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
            <ChartContainer config={chartConfig} className='aspect-auto h-72 w-full'>
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey='t'
                  tickFormatter={(v) => new Date(String(v)).toLocaleDateString()}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} unit='%' width={40} />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={(l) => new Date(String(l)).toLocaleString()} />}
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
                  />
                ))}
                {metrics.map((m) => (
                  <Line
                    key={`${m}__pace`}
                    type='monotone'
                    dataKey={`${m}__pace`}
                    stroke={metaFor(m).color}
                    strokeDasharray='4 4'
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    legendType='none'
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
