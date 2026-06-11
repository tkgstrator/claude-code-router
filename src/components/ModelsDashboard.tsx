import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Circle, LoaderCircle, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { ProviderIcon } from '@/lib/providerIcons'
import { MODEL_PRICING } from '@/shared/data'

type Reachability = 'unknown' | 'testing' | 'ok' | 'fail'

interface ModelRow {
  provider: string
  model: string
  key: string
  enabled: boolean
  isSubscription: boolean
  deprecated: boolean
  contextWindow?: number
}

// 1_000_000 → "1M", 1_050_000 → "1.05M", 200_000 → "200K", else the
// raw count. Null when the vendor doesn't publish a context window.
const formatContext = (n?: number): string | null => {
  if (!n || n <= 0) return null
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : parseFloat(m.toFixed(2))}M`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

type SortKey = 'provider' | 'model' | 'input' | 'output'

export function ModelsDashboard() {
  const { t } = useTranslation()
  const { config } = useConfig()
  const [status, setStatus] = useState<Record<string, Reachability>>({})
  const [passedAt, setPassedAt] = useState<Record<string, string | null>>({})
  const [isTestingAll, setIsTestingAll] = useState(false)
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [planByProvider, setPlanByProvider] = useState<Record<string, string | null>>({})
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled'>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')

  useEffect(() => {
    const fetchSubscriptions = async () => {
      try {
        const response = await api.get<{
          subscriptions: {
            providerName: string
            enabled: boolean
            activeAccount: { plan: string | null } | null
          }[]
        }>('/subscriptions')
        const map: Record<string, string | null> = {}
        for (const entry of response.subscriptions) {
          map[entry.providerName] = entry.activeAccount?.plan ?? null
        }
        setPlanByProvider(map)
      } catch (error) {
        console.error('Failed to fetch subscriptions:', error)
      }
    }
    fetchSubscriptions()
  }, [config])

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    if (sortDir === 'asc') {
      setSortDir('desc')
      return
    }
    setSortKey(null)
  }

  const rows = useMemo<ModelRow[]>(() => {
    const providers = Array.isArray(config?.Providers) ? config.Providers : []
    const raw = providers.flatMap((provider) => {
      if (!provider) return []
      const providerName = provider.name || 'unknown'
      if (provider.enabled === false) return []
      const providerAvailable =
        provider.auth_mode === 'subscription'
          ? Boolean(planByProvider[providerName])
          : (provider.api_key?.trim().length ?? 0) > 0
      if (!providerAvailable) return []
      const models = Array.isArray(provider.models) ? provider.models : []
      const disabledList = Array.isArray((provider.transformer as Record<string, unknown> | undefined)?._disabledModels)
        ? (provider.transformer as Record<string, string[]>)._disabledModels
        : []
      const isSubscription = provider.auth_mode === 'subscription'
      const deprecatedSet = new Set(provider.deprecatedModels ?? [])
      const ctxMap = provider.modelContextWindows ?? {}
      return models.map((model: string) => {
        const key = `${providerName},${model}`
        const enabled = !disabledList.includes(model)
        const deprecated = deprecatedSet.has(model)
        return { provider: providerName, model, key, enabled, isSubscription, deprecated, contextWindow: ctxMap[model] }
      })
    })
    // No active sort: keep the natural order — providers in config order,
    // models in their per-provider order. We used to fall through to an
    // alphabetical model tiebreak here, which surfaced "openai
    // chatgpt-4o-latest" at the top because 'cha' < 'cla'.
    if (!sortKey) return raw
    const sign = sortDir === 'asc' ? 1 : -1
    const priceOf = (model: string, which: 'inputPer1M' | 'outputPer1M') =>
      MODEL_PRICING[model]?.[which] ?? Number.POSITIVE_INFINITY
    const primary = (row: ModelRow) => {
      if (sortKey === 'input') return priceOf(row.model, 'inputPer1M')
      if (sortKey === 'output') return priceOf(row.model, 'outputPer1M')
      return row[sortKey]
    }
    // Stable sort on primary only — ties preserve raw (provider-grouped,
    // config-ordered) order, so sorting by Provider doesn't reorder the
    // models inside each group.
    return [...raw].sort((a, b) => {
      const av = primary(a)
      const bv = primary(b)
      if (av < bv) return -1 * sign
      if (av > bv) return 1 * sign
      return 0
    })
  }, [config, sortKey, sortDir, planByProvider])

  const providerNames = useMemo(() => {
    const names = new Set(rows.map((r) => r.provider))
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (statusFilter === 'enabled' && !row.enabled) return false
        if (providerFilter !== 'all' && row.provider !== providerFilter) return false
        return true
      }),
    [rows, statusFilter, providerFilter]
  )

  const SortHeader = ({
    label,
    sortKey: key,
    align = 'left'
  }: {
    label: string
    sortKey: SortKey
    align?: 'left' | 'right'
  }) => {
    const active = sortKey === key
    const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <button
        type='button'
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground`}
      >
        {label}
        <Icon className='h-3 w-3' />
      </button>
    )
  }

  // Seed status + last-passed date from the DB-backed config so the
  // dashboard reflects persisted test results across reloads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when config changes
  useEffect(() => {
    const providers = Array.isArray(config?.Providers) ? config.Providers : []
    const nextStatus: Record<string, Reachability> = {}
    const nextPassed: Record<string, string | null> = {}
    for (const p of providers) {
      const map = p?.modelTestStatus
      if (!map) continue
      for (const model of Object.keys(map)) {
        const info = map[model]
        const key = `${p.name},${model}`
        nextStatus[key] = info.status
        nextPassed[key] = info.passedAt
      }
    }
    setStatus(nextStatus)
    setPassedAt(nextPassed)
  }, [config])

  const applyResult = (key: string, result: { status: 'ok' | 'fail' }) => {
    setStatus((prev) => ({ ...prev, [key]: result.status }))
    if (result.status === 'ok') {
      setPassedAt((prev) => ({ ...prev, [key]: dayjs().toISOString() }))
    }
  }

  // Real-inference test of one model (max_tokens=1 ping to the vendor).
  const testOne = async (row: ModelRow) => {
    setStatus((prev) => ({ ...prev, [row.key]: 'testing' }))
    try {
      const res = await api.post<{ status: 'ok' | 'fail'; error?: string }>('/models/test', {
        provider: row.provider,
        model: row.model
      })
      applyResult(row.key, res)
    } catch {
      setStatus((prev) => ({ ...prev, [row.key]: 'fail' }))
    }
  }

  const runTestAll = async (scope: 'all' | 'failing') => {
    setScopeDialogOpen(false)
    setIsTestingAll(true)
    // Optimistically mark only the in-scope ENABLED rows as testing —
    // the server skips disabled models, so marking them would leave
    // their spinner stuck forever.
    setStatus((prev) => {
      const next = { ...prev }
      for (const row of rows) {
        if (!row.enabled) continue
        if (scope === 'all' || next[row.key] !== 'ok') next[row.key] = 'testing'
      }
      return next
    })
    try {
      const res = await api.post<{
        results: { provider: string; model: string; status: 'ok' | 'fail' }[]
      }>('/models/test-all', { scope })
      for (const r of res.results) applyResult(`${r.provider},${r.model}`, r)
    } catch {
      // Leave rows as-is; individual retries are available.
    } finally {
      setIsTestingAll(false)
    }
  }

  const renderStatus = (state: Reachability) => {
    if (state === 'testing') {
      return (
        <LoaderCircle className='h-4 w-4 animate-spin text-muted-foreground' aria-label={t('models.status_testing')} />
      )
    }
    if (state === 'ok') {
      return <CheckCircle2 className='h-4 w-4 text-green-600' aria-label={t('models.status_ok')} />
    }
    if (state === 'fail') {
      return <XCircle className='h-4 w-4 text-red-600' aria-label={t('models.status_fail')} />
    }
    return <Circle className='h-4 w-4 text-muted-foreground/40' aria-label={t('models.status_unknown')} />
  }

  return (
    <PageContainer>
      <PageHeader title={t('nav.models')}>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className='h-9 w-44'>
            <SelectValue placeholder={t('models.filter_provider')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('models.filter_all_providers')}</SelectItem>
            {providerNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === 'enabled' ? 'enabled' : 'all')}>
          <SelectTrigger className='h-9 w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('models.filter_show_all')}</SelectItem>
            <SelectItem value='enabled'>{t('models.filter_enabled_only')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() => setScopeDialogOpen(true)}
          disabled={isTestingAll || visibleRows.length === 0}
          variant='outline'
          className='transition-all-ease hover:scale-[1.02] active:scale-[0.98]'
        >
          {isTestingAll ? t('models.status_testing') : t('models.test_all')}
        </Button>
      </PageHeader>

      <Dialog open={scopeDialogOpen} onOpenChange={setScopeDialogOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('models.test_all_title')}</DialogTitle>
            <DialogDescription>{t('models.test_all_desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className='flex-col gap-2 sm:flex-row sm:justify-end'>
            <Button variant='outline' onClick={() => runTestAll('failing')}>
              {t('models.test_all_failing')}
            </Button>
            <Button onClick={() => runTestAll('all')}>{t('models.test_all_all')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PageContent className='p-0'>
        {visibleRows.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center'>
            <p className='text-sm text-muted-foreground'>{t('models.no_models')}</p>
          </div>
        ) : (
          <table className='w-full text-sm'>
            <thead className='sticky top-0 bg-muted text-left text-muted-foreground'>
              <tr>
                <th className='px-6 py-2 font-medium'>
                  <SortHeader label={t('models.provider')} sortKey='provider' />
                </th>
                <th className='px-6 py-2 font-medium'>
                  <SortHeader label={t('models.model')} sortKey='model' />
                </th>
                <th className='px-6 py-2 font-medium text-right'>
                  <SortHeader label={t('models.input')} sortKey='input' align='right' />
                </th>
                <th className='px-6 py-2 font-medium text-right'>
                  <SortHeader label={t('models.output')} sortKey='output' align='right' />
                </th>
                <th className='px-2 py-2 font-medium text-center'>{t('models.status')}</th>
                <th className='px-6 py-2 font-medium text-right'>{t('models.context_window')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.key} className={`border-t hover:bg-muted ${row.enabled ? '' : 'opacity-50'}`}>
                  <td className='px-6 py-2 text-foreground'>
                    <span className='inline-flex items-center gap-2'>
                      <ProviderIcon name={row.provider} size={16} />
                      {row.provider}
                    </span>
                  </td>
                  <td className='px-6 py-2 font-mono text-xs text-foreground'>
                    <span className='inline-flex items-center gap-2'>
                      {row.model}
                      {row.deprecated && (
                        <Badge variant='outline' className='border-amber-300 bg-amber-50 text-[10px] text-amber-700'>
                          {t('models.deprecated')}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className='px-6 py-2 whitespace-nowrap text-right text-xs text-muted-foreground'>
                    {MODEL_PRICING[row.model] ? (
                      <span title={t(row.isSubscription ? 'models.cost_hint_subscription' : 'models.cost_hint')}>
                        ${MODEL_PRICING[row.model].inputPer1M}
                      </span>
                    ) : (
                      <span className='text-muted-foreground/40'>—</span>
                    )}
                  </td>
                  <td className='px-6 py-2 whitespace-nowrap text-right text-xs text-muted-foreground'>
                    {MODEL_PRICING[row.model] ? (
                      <span title={t(row.isSubscription ? 'models.cost_hint_subscription' : 'models.cost_hint')}>
                        ${MODEL_PRICING[row.model].outputPer1M}
                      </span>
                    ) : (
                      <span className='text-muted-foreground/40'>—</span>
                    )}
                  </td>
                  <td className='px-2 py-2'>
                    <div className='flex justify-center'>
                      <button
                        type='button'
                        onClick={() => testOne(row)}
                        disabled={isTestingAll || !row.enabled || status[row.key] === 'testing'}
                        title={
                          passedAt[row.key]
                            ? `${t('models.last_passed')}: ${dayjs(passedAt[row.key] as string).format('YYYY/MM/DD HH:mm')}`
                            : t('models.test')
                        }
                        className='rounded-md p-1 transition-all-ease hover:bg-accent disabled:cursor-not-allowed disabled:hover:bg-transparent'
                      >
                        {renderStatus(status[row.key] || 'unknown')}
                      </button>
                    </div>
                  </td>
                  <td className='px-6 py-2 whitespace-nowrap text-right text-xs text-muted-foreground'>
                    {formatContext(row.contextWindow) ? (
                      <span>{formatContext(row.contextWindow)}</span>
                    ) : (
                      <span className='text-muted-foreground/40'>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageContent>
    </PageContainer>
  )
}
