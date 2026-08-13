import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
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
import { fmtCost, fmtTokens } from '@/lib/usage/format'
import type { CostHistoryResponse, ModelCost, ProviderCost, UsageCostResponse } from '@/lib/usage/types'

const PROVIDER_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']
// Per-provider model palette — eight tailwind-500 hues at ~45° hue steps.
// The prior set had two blues and two pinks that read as duplicates in
// small wedges (h-32 donut) and 10-px legend dots; the eight primaries
// below stay distinguishable when wedges get narrow.
const MODEL_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#ef4444', '#a855f7', '#eab308', '#ec4899', '#06b6d4']

type Metric = 'cost' | 'requests'

interface DonutSlice {
  key: string
  label: string
  value: number
  fill: string
}

// Compute per-provider model slices for the current metric. Models with a
// zero/missing value under the active metric are dropped from the donut —
// an empty wedge is worse than nothing. Sorted biggest-first so the color
// palette assigns the loudest hues to the top contributors.
function providerModelSlices(models: ModelCost[], metric: Metric): DonutSlice[] {
  const withValues = models.flatMap((m) => {
    const v = metric === 'cost' ? m.totalCostUsd : m.requestCount
    if (v === null || v <= 0) return []
    return [{ model: m.model, value: v }]
  })
  withValues.sort((a, b) => b.value - a.value)
  return withValues.map((r, i) => ({
    key: r.model,
    label: r.model,
    value: r.value,
    fill: MODEL_COLORS[i % MODEL_COLORS.length]
  }))
}

// Compact donut for the per-provider model breakdown. No legend — the
// sibling table lists the models with matching color dots, so a legend
// would just duplicate what's already right next to it.
function ProviderModelDonut({ slices }: { slices: DonutSlice[] }) {
  const config: ChartConfig = Object.fromEntries(slices.map((d) => [d.key, { label: d.label, color: d.fill }]))
  return (
    <ChartContainer config={config} className='aspect-square h-32 shrink-0'>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={slices}
          dataKey='value'
          nameKey='label'
          innerRadius='55%'
          outerRadius='95%'
          paddingAngle={1.5}
          strokeWidth={0}
          isAnimationActive={false}
        >
          {slices.map((d) => (
            <Cell key={d.key} fill={d.fill} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}

export function ApiCost() {
  const { t } = useTranslation()
  const [costData, setCostData] = useState<UsageCostResponse | null>(null)
  const [costHistory, setCostHistory] = useState<CostHistoryResponse | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [costDays, setCostDays] = useState(30)
  // Whether the per-provider donuts split by dollars spent or by request
  // volume. Cost and request distributions can look very different (a few
  // opus calls dominate cost; many haiku calls dominate volume) so both
  // views are useful.
  const [metric, setMetric] = useState<Metric>('cost')

  const refreshCost = useCallback(() => {
    setCostLoading(true)
    Promise.all([
      api.get<UsageCostResponse>(`/usage/cost?days=${costDays}`).catch(() => ({ providers: [], days: costDays })),
      api
        // Daily Cost always shows the last two weeks regardless of the period
        // selector (which drives the totals table only); route.ts zero-fills
        // missing days so it renders 14 bars even when data is sparse/empty.
        .get<CostHistoryResponse>('/usage/cost/history?days=14')
        .catch(() => ({ points: [], providers: [], granularity: 'day' as const, days: 14 }))
    ]).then(([cost, history]) => {
      setCostData(cost)
      setCostHistory(history)
      setCostLoading(false)
    })
  }, [costDays])

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

  return (
    <PageContainer>
      <PageHeader title={t('usage.apiCost')}>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='flex gap-1'>
            {(['cost', 'requests'] as const).map((m) => (
              <Button
                key={m}
                variant={metric === m ? 'default' : 'ghost'}
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={() => setMetric(m)}
              >
                {m === 'cost' ? t('usage.apiCostMetricCost') : t('usage.apiCostMetricRequests')}
              </Button>
            ))}
          </div>
          <div className='flex gap-1'>
            {([7, 30, 0] as const).map((d) => (
              <Button
                key={d}
                variant={costDays === d ? 'default' : 'ghost'}
                size='sm'
                className='h-7 px-2 text-xs'
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
      </PageHeader>
      <PageContent className={`transition-opacity duration-150 ${costLoading ? 'pointer-events-none opacity-50' : ''}`}>
        <section className='space-y-3'>
          {costData === null ? (
            <p className='text-sm text-muted-foreground'>…</p>
          ) : costData.providers.length === 0 ? (
            <p className='text-sm text-muted-foreground'>{t('usage.apiCostEmpty')}</p>
          ) : (
            // Auto-fill grid: one cell per provider so the per-model cost
            // tables stay a readable width instead of spanning the full page.
            // Cell min raised to fit an inline model-share donut beside the
            // detail table without squeezing either.
            <div className='grid grid-cols-[repeat(auto-fill,minmax(32rem,1fr))] items-start gap-x-8 gap-y-6'>
              {costData.providers.map((p) => (
                <ProviderCard key={p.provider} provider={p} metric={metric} />
              ))}
            </div>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='border-b pb-2 text-base font-semibold'>{t('usage.apiCostHistory')}</h3>
          {costHistory === null || costHistory.points.length === 0 ? (
            <p className='text-sm text-muted-foreground'>{t('usage.apiCostHistoryEmpty')}</p>
          ) : (
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
                      formatter={(value) => fmtCost(Number(value), '—')}
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
          )}
        </section>
      </PageContent>
    </PageContainer>
  )
}

// One provider card: header (name + total), then donut (left) + model
// detail table (right). The donut wedges and the table's leading color
// dot share a palette so the reader can trace "big pink wedge → this row".
function ProviderCard({ provider, metric }: { provider: ProviderCost; metric: Metric }) {
  const { t } = useTranslation()
  const slices = useMemo(() => providerModelSlices(provider.models, metric), [provider.models, metric])
  // Sort the table to mirror the donut ordering. Models with no value
  // under the active metric sink to the bottom; they still render (a
  // model with cost-null but requests>0 shouldn't vanish under 'cost'),
  // just without a color dot.
  const sortedModels = useMemo(() => {
    const scored = provider.models.map((m) => {
      const raw = metric === 'cost' ? m.totalCostUsd : m.requestCount
      const score = raw === null || raw <= 0 ? -1 : raw
      return { model: m, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.model)
  }, [provider.models, metric])
  const colorByModel = useMemo(() => new Map(slices.map((s) => [s.key, s.fill])), [slices])

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium'>{provider.provider}</span>
        <span className='text-sm font-medium tabular-nums'>
          {fmtCost(provider.totalCostUsd, t('usage.apiCostNoPricing'))}
        </span>
      </div>
      <div className='flex flex-wrap items-start gap-4'>
        {slices.length > 0 && <ProviderModelDonut slices={slices} />}
        <table className='min-w-0 flex-1 text-xs'>
          <tbody>
            {sortedModels.map((m) => {
              const dot = colorByModel.get(m.model)
              return (
                <tr key={m.model}>
                  <td className='py-1 pr-2 font-mono text-muted-foreground'>
                    <span className='inline-flex items-center gap-2'>
                      <span
                        className='h-2.5 w-2.5 shrink-0 rounded-full'
                        style={{ backgroundColor: dot === undefined ? 'transparent' : dot }}
                      />
                      {m.model}
                    </span>
                  </td>
                  <td className='whitespace-nowrap px-2 py-1 text-right text-muted-foreground tabular-nums'>
                    {m.requestCount.toLocaleString()} {t('usage.apiCostRequests')}
                  </td>
                  <td className='whitespace-nowrap px-2 py-1 text-right text-muted-foreground tabular-nums'>
                    ↑{fmtTokens(m.inputTokens + m.cacheWriteTokens)} ↓{fmtTokens(m.outputTokens)}
                  </td>
                  <td className='whitespace-nowrap py-1 pl-2 text-right font-medium tabular-nums'>
                    {fmtCost(m.totalCostUsd, t('usage.apiCostNoPricing'))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
