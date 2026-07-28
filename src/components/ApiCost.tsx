import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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
import type { CostHistoryResponse, UsageCostResponse } from '@/lib/usage/types'

const PROVIDER_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']

export function ApiCost() {
  const { t } = useTranslation()
  const [costData, setCostData] = useState<UsageCostResponse | null>(null)
  const [costHistory, setCostHistory] = useState<CostHistoryResponse | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [costDays, setCostDays] = useState(30)

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
            <div className='grid grid-cols-[repeat(auto-fill,minmax(28rem,1fr))] items-start gap-x-8 gap-y-6'>
              {costData.providers.map((p) => (
                <div key={p.provider} className='space-y-1'>
                  <div className='flex items-center justify-between'>
                    <span className='text-sm font-medium'>{p.provider}</span>
                    <span className='text-sm font-medium tabular-nums'>
                      {fmtCost(p.totalCostUsd, t('usage.apiCostNoPricing'))}
                    </span>
                  </div>
                  <table className='w-full text-xs'>
                    <tbody>
                      {p.models.map((m) => (
                        <tr key={m.model}>
                          <td className='py-1 pr-2 font-mono text-muted-foreground'>{m.model}</td>
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
                      ))}
                    </tbody>
                  </table>
                </div>
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
