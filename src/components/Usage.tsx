import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
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
import { ClaudeAccountSection } from '@/components/usage/ClaudeAccountSection'
import { CodexAccountSection } from '@/components/usage/CodexAccountSection'
import { ModelRoutingSection } from '@/components/usage/ModelRoutingSection'
import { NotRegistered } from '@/components/usage/NotRegistered'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { CAP_PCT, fmtCost, fmtTokens, metaFor, projectedUsage } from '@/lib/usage/format'
import type { CostHistoryResponse, CurrentUsageResponse, HistoryResponse, UsageCostResponse } from '@/lib/usage/types'

const REFRESH_MS = 5 * 60_000

const CLAUDE_SUBSCRIBE_URL = 'https://claude.ai'
const CODEX_SUBSCRIBE_URL = 'https://chatgpt.com'

const PROVIDER_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']

export function Usage() {
  const { t } = useTranslation()
  const [history, setHistory] = useState<HistoryResponse>({ samples: [] })
  const [costData, setCostData] = useState<UsageCostResponse | null>(null)
  const [costHistory, setCostHistory] = useState<CostHistoryResponse | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [costDays, setCostDays] = useState(30)
  const [current, setCurrent] = useState<CurrentUsageResponse | null>(null)
  const [currentError, setCurrentError] = useState(false)
  const [syncing, setSyncing] = useState(false)
  // Bumped on Sync so the model-routing section refetches alongside the
  // rest of the page.
  const [routingReload, setRoutingReload] = useState(0)

  const refreshLive = useCallback(() => {
    api
      .get<HistoryResponse>('/usage/history?days=7')
      .then(setHistory)
      .catch(() => setHistory({ samples: [] }))
    api
      .get<CurrentUsageResponse>('/usage')
      .then((d) => {
        setCurrent(d)
        setCurrentError(false)
      })
      .catch(() => setCurrentError(true))
  }, [])

  const refreshCost = useCallback(() => {
    setCostLoading(true)
    Promise.all([
      api.get<UsageCostResponse>(`/usage/cost?days=${costDays}`).catch(() => ({ providers: [], days: costDays })),
      api
        // Daily Cost always shows the last week regardless of the period
        // selector (which drives the totals table only); route.ts zero-fills
        // missing days so it renders 7 bars even when data is sparse/empty.
        .get<CostHistoryResponse>('/usage/cost/history?days=7')
        .catch(() => ({ points: [], providers: [], granularity: 'day' as const, days: 7 }))
    ]).then(([cost, history]) => {
      setCostData(cost)
      setCostHistory(history)
      setCostLoading(false)
    })
  }, [costDays])

  // Sync = pull fresh subscription profile data upstream, then re-fetch
  // every usage panel so the API-cost breakdown reflects the newly
  // discovered plan (which drives the subscription savings row).
  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.post('/subscriptions/sync', {})
    } catch (err) {
      console.error('Failed to sync subscriptions:', err)
    } finally {
      refreshLive()
      refreshCost()
      setRoutingReload((n) => n + 1)
      setSyncing(false)
    }
  }

  useEffect(() => {
    refreshLive()
    const id = setInterval(refreshLive, REFRESH_MS)
    return () => clearInterval(id)
  }, [refreshLive])

  useEffect(() => {
    refreshCost()
  }, [refreshCost])

  const costHistoryConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {}
    for (const [i, p] of (costHistory?.providers ?? []).entries()) {
      cfg[p] = { label: p, color: PROVIDER_COLORS[i % PROVIDER_COLORS.length] }
    }
    return cfg
  }, [costHistory])

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
      <PageHeader title={t('usage.title')}>
        <Button variant='outline' onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {t('usage.sync')}
        </Button>
      </PageHeader>
      <PageContent className='space-y-6'>
        {currentError && <div className='text-sm text-red-500'>{t('usage.loadError')}</div>}

        <section className='space-y-3'>
          <h3 className='text-base font-semibold'>{t('usage.current')}</h3>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='space-y-3'>
              <h4 className='text-sm font-semibold text-muted-foreground'>{t('usage.claude')}</h4>
              {current === null ? (
                <p className='text-sm text-muted-foreground'>…</p>
              ) : current.claude.length === 0 ? (
                <NotRegistered
                  message={t('usage.claudeNotRegistered')}
                  hint={t('usage.claudeNotRegisteredHint')}
                  href={CLAUDE_SUBSCRIBE_URL}
                  cta={t('usage.openSubscriptionPage')}
                />
              ) : (
                <div className='space-y-3'>
                  {current.claude.map((account) => (
                    <ClaudeAccountSection key={account.accountLabel} account={account} />
                  ))}
                </div>
              )}
            </div>
            <div className='space-y-3'>
              <h4 className='text-sm font-semibold text-muted-foreground'>{t('usage.codex')}</h4>
              {current === null ? (
                <p className='text-sm text-muted-foreground'>…</p>
              ) : current.codex.length === 0 ? (
                <NotRegistered
                  message={t('usage.codexNotRegistered')}
                  hint={t('usage.codexNotRegisteredHint')}
                  href={CODEX_SUBSCRIBE_URL}
                  cta={t('usage.openSubscriptionPage')}
                />
              ) : (
                <div className='space-y-3'>
                  {current.codex.map((account) => (
                    <CodexAccountSection key={account.accountLabel} account={account} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <ModelRoutingSection reloadToken={routingReload} />

        <section className='space-y-3'>
          <div className='flex items-center justify-between'>
            <h3 className='text-base font-semibold'>{t('usage.apiCost')}</h3>
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
          <h3 className='text-base font-semibold'>{t('usage.apiCostHistory')}</h3>
          {costHistory === null || costHistory.points.length === 0 ? (
            <p className='text-sm text-muted-foreground'>{t('usage.apiCostHistoryEmpty')}</p>
          ) : (
            <div className={`transition-opacity duration-150 ${costLoading ? 'pointer-events-none opacity-50' : ''}`}>
              <ChartContainer config={costHistoryConfig} className='aspect-auto h-56 w-full'>
                <BarChart data={costHistory.points} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey='date'
                    tickFormatter={(v) =>
                      costHistory.granularity === 'week'
                        ? `${dayjs(String(v)).format('M/D')}~`
                        : dayjs(String(v)).format('M/D')
                    }
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                  />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${v}`} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(l) =>
                          costHistory.granularity === 'week'
                            ? `${dayjs(String(l)).format('YYYY/M/D')}~`
                            : dayjs(String(l)).format('YYYY/M/D')
                        }
                        formatter={(value) => `$${Number(value).toFixed(2)}`}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {(costHistory.providers ?? []).map((p, i) => (
                    <Bar
                      key={p}
                      dataKey={p}
                      stackId='cost'
                      fill={PROVIDER_COLORS[i % PROVIDER_COLORS.length]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
            </div>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='text-base font-semibold'>{t('usage.history')}</h3>
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
