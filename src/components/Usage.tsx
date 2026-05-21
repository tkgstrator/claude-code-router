import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
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

const CLAUDE_SUBSCRIBE_URL = 'https://claude.ai'
const CODEX_SUBSCRIBE_URL = 'https://chatgpt.com'

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
interface ClaudeAccountUsage {
  accountLabel: string
  fiveHour: ClaudeWindow | null
  sevenDay: ClaudeWindow | null
  sevenDaySonnet: ClaudeWindow | null
  sevenDayOpus: ClaudeWindow | null
  extraUsageEnabled: boolean
  capturedAt: string
}
interface CodexAccountUsage {
  accountLabel: string
  planType: string | null
  primary: CodexWindow | null
  secondary: CodexWindow | null
  capturedAt: string
}
interface UsageResponse {
  claude: ClaudeAccountUsage[]
  codex: CodexAccountUsage[]
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
        <span className='text-muted-foreground'>{percent.toFixed(1)}%</span>
      </div>
      <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
        <div className='h-full rounded-full bg-blue-500' style={{ width: `${clamped}%` }} />
      </div>
      <div className='text-xs text-muted-foreground'>{reset}</div>
    </div>
  )
}

function NotRegistered({ message, hint, href, cta }: { message: string; hint: string; href: string; cta: string }) {
  return (
    <div className='space-y-1 text-sm text-muted-foreground'>
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

function ClaudeAccountSection({ account, t }: { account: ClaudeAccountUsage; t: (k: string) => string }) {
  return (
    <div className='space-y-3 rounded-md border p-4'>
      <p className='text-sm font-medium text-foreground'>{account.accountLabel}</p>
      {account.fiveHour && (
        <UsageBar
          label={t('usage.fiveHour')}
          percent={account.fiveHour.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.fiveHour.resetsAt)}`}
        />
      )}
      {account.sevenDay && (
        <UsageBar
          label={t('usage.sevenDay')}
          percent={account.sevenDay.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.sevenDay.resetsAt)}`}
        />
      )}
      {account.sevenDaySonnet && (
        <UsageBar
          label={t('usage.sevenDaySonnet')}
          percent={account.sevenDaySonnet.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.sevenDaySonnet.resetsAt)}`}
        />
      )}
      {account.sevenDayOpus && (
        <UsageBar
          label={t('usage.sevenDayOpus')}
          percent={account.sevenDayOpus.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.sevenDayOpus.resetsAt)}`}
        />
      )}
      <div className='text-xs text-muted-foreground'>
        {t('usage.capturedAt')}: {fmtReset(account.capturedAt)}
      </div>
    </div>
  )
}

function CodexAccountSection({ account, t }: { account: CodexAccountUsage; t: (k: string) => string }) {
  return (
    <div className='space-y-3 rounded-md border p-4'>
      <p className='text-sm font-medium text-foreground'>{account.accountLabel}</p>
      {account.primary && (
        <UsageBar
          label={t('usage.primary')}
          percent={account.primary.usedPercent}
          reset={`${t('usage.resets')}: ${fmtReset(account.primary.resetAt)}`}
        />
      )}
      {account.secondary && (
        <UsageBar
          label={t('usage.secondary')}
          percent={account.secondary.usedPercent}
          reset={`${t('usage.resets')}: ${fmtReset(account.secondary.resetAt)}`}
        />
      )}
      <div className='text-xs text-muted-foreground'>
        {t('usage.capturedAt')}: {fmtReset(account.capturedAt)}
      </div>
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
        {error && <div className='text-sm text-red-500'>{t('usage.loadError')}</div>}

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('usage.claude')}</h3>
          {data?.claude.length === 0 ? (
            <NotRegistered
              message={t('usage.claudeNotRegistered')}
              hint={t('usage.claudeNotRegisteredHint')}
              href={CLAUDE_SUBSCRIBE_URL}
              cta={t('usage.openSubscriptionPage')}
            />
          ) : (
            <div className='space-y-3'>
              {data?.claude.map((account) => (
                <ClaudeAccountSection key={account.accountLabel} account={account} t={t} />
              ))}
            </div>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('usage.codex')}</h3>
          {data?.codex.length === 0 ? (
            <NotRegistered
              message={t('usage.codexNotRegistered')}
              hint={t('usage.codexNotRegisteredHint')}
              href={CODEX_SUBSCRIBE_URL}
              cta={t('usage.openSubscriptionPage')}
            />
          ) : (
            <div className='space-y-3'>
              {data?.codex.map((account) => (
                <CodexAccountSection key={account.accountLabel} account={account} t={t} />
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
