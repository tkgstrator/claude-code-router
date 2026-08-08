import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
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
import { buildModelRows, sortModelRows } from '@/lib/models/build-rows'
import type { ModelRow, Reachability, SortKey } from '@/lib/models/types'
import { ProviderIcon } from '@/lib/providerIcons'
import { ContextWindowCell } from './models/ContextWindowCell'
import { SortHeader } from './models/SortHeader'
import { StatusIcon } from './models/StatusIcon'

export function ModelsDashboard() {
  const { t } = useTranslation()
  const { config, reloadConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
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

  const rows = useMemo(() => {
    const providers = Array.isArray(config?.Providers) ? config.Providers : []
    return sortModelRows(buildModelRows(providers, planByProvider), sortKey, sortDir)
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
          <div className='flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center'>
            <p className='text-sm text-muted-foreground'>{t('models.no_models')}</p>
          </div>
        ) : (
          <table className='w-full text-sm'>
            <thead className='sticky top-0 bg-muted text-left text-muted-foreground'>
              <tr>
                <th className='px-6 py-2 font-medium'>
                  <SortHeader
                    label={t('models.provider')}
                    sortKey='provider'
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                  />
                </th>
                <th className='px-6 py-2 font-medium'>
                  <SortHeader
                    label={t('models.model')}
                    sortKey='model'
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                  />
                </th>
                <th className='px-6 py-2 font-medium text-right'>
                  <SortHeader
                    label={t('models.input')}
                    sortKey='input'
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                    align='right'
                  />
                </th>
                <th className='px-6 py-2 font-medium text-right'>
                  <SortHeader
                    label={t('models.output')}
                    sortKey='output'
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                    align='right'
                  />
                </th>
                <th className='px-2 py-2 font-medium text-center'>{t('models.status')}</th>
                <th className='px-6 py-2 font-medium text-right'>{t('models.context_window')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const passedAtValue = passedAt[row.key]
                return (
                  <tr
                    key={row.key}
                    className={`border-t transition-colors hover:bg-muted/50 ${row.enabled ? '' : 'opacity-50'}`}
                  >
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
                      {row.inputPer1M != null ? (
                        <span title={t(row.isSubscription ? 'models.cost_hint_subscription' : 'models.cost_hint')}>
                          ${row.inputPer1M}
                        </span>
                      ) : (
                        <span className='text-muted-foreground/40'>—</span>
                      )}
                    </td>
                    <td className='px-6 py-2 whitespace-nowrap text-right text-xs text-muted-foreground'>
                      {row.outputPer1M != null ? (
                        <span title={t(row.isSubscription ? 'models.cost_hint_subscription' : 'models.cost_hint')}>
                          ${row.outputPer1M}
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
                            passedAtValue
                              ? `${t('models.last_passed')}: ${dayjs(passedAtValue).format('YYYY/MM/DD HH:mm')}`
                              : t('models.test')
                          }
                          className='rounded-md p-1 transition-all-ease hover:bg-accent disabled:cursor-not-allowed disabled:hover:bg-transparent'
                        >
                          <StatusIcon state={status[row.key] || 'unknown'} />
                        </button>
                      </div>
                    </td>
                    <td className='px-6 py-2 whitespace-nowrap text-right text-xs text-muted-foreground'>
                      <ContextWindowCell
                        provider={row.provider}
                        model={row.model}
                        value={row.contextWindow}
                        onSaved={reloadConfig}
                        onError={(msg) => showToast(msg, 'error')}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </PageContent>
    </PageContainer>
  )
}
