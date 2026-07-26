import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { ClaudeAccountSection } from '@/components/usage/ClaudeAccountSection'
import { CodexAccountSection } from '@/components/usage/CodexAccountSection'
import { ModelRoutingSection } from '@/components/usage/ModelRoutingSection'
import { NotRegistered } from '@/components/usage/NotRegistered'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { CAP_PCT, metaFor, projectedUsage } from '@/lib/usage/format'
import type { CurrentUsageResponse, HistoryResponse, SubscriptionsResponse } from '@/lib/usage/types'

const REFRESH_MS = 5 * 60_000

const CLAUDE_SUBSCRIBE_URL = 'https://claude.ai'
const CODEX_SUBSCRIBE_URL = 'https://chatgpt.com'

export function Usage() {
  const { t } = useTranslation()
  const [history, setHistory] = useState<HistoryResponse>({ samples: [] })
  const [current, setCurrent] = useState<CurrentUsageResponse | null>(null)
  // Account roster + auth health. Authoritative source for which accounts
  // exist: dead-auth accounts drop out of /usage but stay in the roster.
  const [subs, setSubs] = useState<SubscriptionsResponse | null>(null)
  const [subsError, setSubsError] = useState(false)
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
      .then(setCurrent)
      .catch(() => setCurrent({ claude: [], codex: [] }))
    api
      .get<SubscriptionsResponse>('/subscriptions')
      .then((d) => {
        setSubs(d)
        setSubsError(false)
      })
      .catch(() => setSubsError(true))
  }, [])

  // Sync = pull fresh subscription profile data upstream (which also
  // re-probes each account's auth), then re-fetch the live panels so the
  // roster and auth health reflect the new state.
  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.post('/subscriptions/sync', {})
    } catch (err) {
      console.error('Failed to sync subscriptions:', err)
    } finally {
      refreshLive()
      setRoutingReload((n) => n + 1)
      setSyncing(false)
    }
  }

  useEffect(() => {
    refreshLive()
    const id = setInterval(refreshLive, REFRESH_MS)
    return () => clearInterval(id)
  }, [refreshLive])

  // Join live usage onto the roster by stable SubAccount id, so an account
  // that failed to poll still renders (with its auth chip) instead of vanishing.
  const claudeUsageById = useMemo(() => new Map((current?.claude ?? []).map((u) => [u.subAccountId, u])), [current])
  const codexUsageById = useMemo(() => new Map((current?.codex ?? []).map((u) => [u.subAccountId, u])), [current])
  const claudeAccounts = useMemo(
    () =>
      (subs?.subscriptions ?? [])
        .filter((p) => p.kind === 'claude')
        .flatMap((p) => p.accounts)
        .filter((a) => a.enabled),
    [subs]
  )
  const codexAccounts = useMemo(
    () =>
      (subs?.subscriptions ?? [])
        .filter((p) => p.kind === 'codex')
        .flatMap((p) => p.accounts)
        .filter((a) => a.enabled),
    [subs]
  )
  const invalidCount = useMemo(
    () => [...claudeAccounts, ...codexAccounts].filter((a) => a.authStatus === 'invalid').length,
    [claudeAccounts, codexAccounts]
  )

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
    // One tick per calendar day so the week reads as a 7-day progression
    // instead of a wall of intraday times.
    const ticks = [...new Map(rows.map((r) => [dayjs(String(r.t)).format('YYYY-MM-DD'), String(r.t)])).values()]
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
      {/* Fluid so the Model routing grid can span the full width; the
          rate-limit panel and every heading below re-apply the shared
          max-w-5xl cap so they stay aligned with the (capped) page header. */}
      <PageContent fluid>
        {/* ── Rate limits + auth health ─────────────────────────────── */}
        <section className='w-full max-w-5xl space-y-4'>
          <h3 className='border-b pb-2 text-base font-semibold'>{t('usage.current')}</h3>
          {subsError && <p className='text-sm text-red-500'>{t('usage.loadError')}</p>}
          {invalidCount > 0 && (
            <div className='rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400'>
              {t('usage.reauthNeeded', { count: invalidCount })}
            </div>
          )}
          <div className='grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2'>
            <div className='space-y-3'>
              <h4 className='border-b pb-2 text-sm font-semibold text-muted-foreground'>{t('usage.claude')}</h4>
              {subs === null ? (
                <p className='text-sm text-muted-foreground'>…</p>
              ) : claudeAccounts.length === 0 ? (
                <NotRegistered
                  message={t('usage.claudeNotRegistered')}
                  hint={t('usage.claudeNotRegisteredHint')}
                  href={CLAUDE_SUBSCRIBE_URL}
                  cta={t('usage.openSubscriptionPage')}
                />
              ) : (
                <div className='divide-y divide-border'>
                  {claudeAccounts.map((account) => (
                    <ClaudeAccountSection
                      key={account.id}
                      account={account}
                      usage={claudeUsageById.get(account.id) ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className='space-y-3'>
              <h4 className='border-b pb-2 text-sm font-semibold text-muted-foreground'>{t('usage.codex')}</h4>
              {subs === null ? (
                <p className='text-sm text-muted-foreground'>…</p>
              ) : codexAccounts.length === 0 ? (
                <NotRegistered
                  message={t('usage.codexNotRegistered')}
                  hint={t('usage.codexNotRegisteredHint')}
                  href={CODEX_SUBSCRIBE_URL}
                  cta={t('usage.openSubscriptionPage')}
                />
              ) : (
                <div className='divide-y divide-border'>
                  {codexAccounts.map((account) => (
                    <CodexAccountSection
                      key={account.id}
                      account={account}
                      usage={codexUsageById.get(account.id) ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Past-week utilization trend */}
          <div className='space-y-2 border-t pt-4'>
            <p className='text-sm font-medium text-muted-foreground'>{t('usage.history')}</p>
            {rows.length === 0 ? (
              <p className='text-sm text-muted-foreground'>{t('usage.historyEmpty')}</p>
            ) : (
              <ChartContainer config={config} className='aspect-auto h-72 w-full'>
                <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey='t'
                    ticks={ticks}
                    tickFormatter={(val) => dayjs(String(val)).format('M/D')}
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
          </div>
        </section>

        {/* ── Model routing ─────────────────────────────────────────── */}
        <section className='space-y-3'>
          {/* Heading stays capped/aligned; the grid below fills the width. */}
          <div className='w-full max-w-5xl border-b pb-2'>
            <h3 className='text-base font-semibold'>{t('usage.routing')}</h3>
            <p className='text-xs text-muted-foreground'>{t('usage.routingHint')}</p>
          </div>
          <ModelRoutingSection reloadToken={routingReload} />
        </section>
      </PageContent>
    </PageContainer>
  )
}
