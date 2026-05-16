import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Circle, LoaderCircle, Pencil, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfig } from '@/components/ConfigProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ProviderIcon } from '@/lib/providerIcons'
import { MODEL_PRICING } from '@/lib/providerTemplates'

type Reachability = 'unknown' | 'testing' | 'ok' | 'fail'

const ROUTE_KEYS = ['default', 'background', 'think', 'longContext', 'webSearch', 'image'] as const

interface ModelRow {
  provider: string
  model: string
  key: string
  routes: string[]
}

type SortKey = 'provider' | 'model' | 'input' | 'output'

export function ModelsDashboard() {
  const { t } = useTranslation()
  const { config, setConfig } = useConfig()
  const [status, setStatus] = useState<Record<string, Reachability>>({})
  const [isTestingAll, setIsTestingAll] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  const assignToRoute = (route: (typeof ROUTE_KEYS)[number], key: string, checked: boolean) => {
    if (!config) return
    const currentRouter = config.Router || {}
    setConfig({ ...config, Router: { ...currentRouter, [route]: checked ? key : '' } })
  }

  const rows = useMemo<ModelRow[]>(() => {
    const providers = Array.isArray(config?.Providers) ? config.Providers : []
    const routerConfig = config?.Router
    const raw = providers.flatMap((provider) => {
      if (!provider) return []
      const providerName = provider.name || 'unknown'
      const models = Array.isArray(provider.models) ? provider.models : []
      return models.map((model) => {
        const key = `${providerName},${model}`
        const routes = ROUTE_KEYS.filter((routeKey) => routerConfig && routerConfig[routeKey] === key)
        return { provider: providerName, model, key, routes }
      })
    })
    if (!sortKey) return raw
    const sign = sortDir === 'asc' ? 1 : -1
    const priceOf = (model: string, which: 'inputPer1M' | 'outputPer1M') =>
      MODEL_PRICING[model]?.[which] ?? Number.POSITIVE_INFINITY
    return [...raw].sort((a, b) => {
      const av =
        sortKey === 'input'
          ? priceOf(a.model, 'inputPer1M')
          : sortKey === 'output'
            ? priceOf(a.model, 'outputPer1M')
            : a[sortKey]
      const bv =
        sortKey === 'input'
          ? priceOf(b.model, 'inputPer1M')
          : sortKey === 'output'
            ? priceOf(b.model, 'outputPer1M')
            : b[sortKey]
      if (av < bv) return -1 * sign
      if (av > bv) return 1 * sign
      return 0
    })
  }, [config, sortKey, sortDir])

  const SortHeader = ({ label, sortKey: key }: { label: string; sortKey: SortKey }) => {
    const active = sortKey === key
    const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <button
        type='button'
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 ${active ? 'text-gray-900' : 'text-gray-500'} hover:text-gray-900`}
      >
        {label}
        <Icon className='h-3 w-3' />
      </button>
    )
  }

  const testModel = async (row: ModelRow): Promise<Reachability> => {
    try {
      const res = await fetch('/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config?.APIKEY || '',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: row.key,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      })
      return res.ok ? 'ok' : 'fail'
    } catch {
      return 'fail'
    }
  }

  const handleTest = async (row: ModelRow) => {
    setStatus((prev) => ({ ...prev, [row.key]: 'testing' }))
    const result = await testModel(row)
    setStatus((prev) => ({ ...prev, [row.key]: result }))
  }

  const handleTestAll = async () => {
    setIsTestingAll(true)
    setStatus(Object.fromEntries(rows.map((row) => [row.key, 'testing' as Reachability])))
    // Sequential to avoid hammering provider rate limits and to keep
    // the (billed) probe traffic minimal.
    for (const row of rows) {
      const result = await testModel(row)
      setStatus((prev) => ({ ...prev, [row.key]: result }))
    }
    setIsTestingAll(false)
  }

  const renderStatus = (state: Reachability) => {
    if (state === 'testing') {
      return <LoaderCircle className='h-4 w-4 animate-spin text-gray-500' aria-label={t('models.status_testing')} />
    }
    if (state === 'ok') {
      return <CheckCircle2 className='h-4 w-4 text-green-600' aria-label={t('models.status_ok')} />
    }
    if (state === 'fail') {
      return <XCircle className='h-4 w-4 text-red-600' aria-label={t('models.status_fail')} />
    }
    return <Circle className='h-4 w-4 text-gray-300' aria-label={t('models.status_unknown')} />
  }

  return (
    <Card className='flex h-full flex-col border-0 bg-white shadow-none'>
      <CardHeader className='flex flex-row items-center justify-between border-b px-6 py-4'>
        <CardTitle className='text-lg'>{t('nav.models')}</CardTitle>
        <Button
          onClick={handleTestAll}
          disabled={isTestingAll || rows.length === 0}
          variant='outline'
          className='transition-all-ease hover:scale-[1.02] active:scale-[0.98]'
        >
          {isTestingAll ? t('models.status_testing') : t('models.test_all')}
        </Button>
      </CardHeader>
      <CardContent className='flex-grow overflow-auto p-0'>
        {rows.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center'>
            <p className='text-sm text-gray-500'>{t('models.no_models')}</p>
          </div>
        ) : (
          <table className='w-full text-sm'>
            <thead className='sticky top-0 bg-gray-50 text-left text-gray-500'>
              <tr>
                <th className='px-6 py-2 font-medium'>
                  <SortHeader label={t('models.provider')} sortKey='provider' />
                </th>
                <th className='px-6 py-2 font-medium'>
                  <SortHeader label={t('models.model')} sortKey='model' />
                </th>
                <th className='px-6 py-2 font-medium text-right'>
                  <SortHeader label={t('models.input')} sortKey='input' />
                </th>
                <th className='px-6 py-2 font-medium text-right'>
                  <SortHeader label={t('models.output')} sortKey='output' />
                </th>
                <th className='px-2 py-2 font-medium text-center'>{t('models.status')}</th>
                <th className='px-6 py-2 font-medium'>{t('models.routes')}</th>
                <th className='px-6 py-2 font-medium text-right'>{t('models.test')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className='border-t hover:bg-gray-50'>
                  <td className='px-6 py-2 text-gray-700'>
                    <span className='inline-flex items-center gap-2'>
                      <ProviderIcon name={row.provider} size={16} />
                      {row.provider}
                    </span>
                  </td>
                  <td className='px-6 py-2 font-mono text-xs text-gray-800'>{row.model}</td>
                  <td className='px-6 py-2 whitespace-nowrap text-right text-xs text-gray-600'>
                    {MODEL_PRICING[row.model] ? (
                      <span title={t('models.cost_hint')}>${MODEL_PRICING[row.model].inputPer1M}</span>
                    ) : (
                      <span className='text-gray-300'>—</span>
                    )}
                  </td>
                  <td className='px-6 py-2 whitespace-nowrap text-right text-xs text-gray-600'>
                    {MODEL_PRICING[row.model] ? (
                      <span title={t('models.cost_hint')}>${MODEL_PRICING[row.model].outputPer1M}</span>
                    ) : (
                      <span className='text-gray-300'>—</span>
                    )}
                  </td>
                  <td className='px-2 py-2 text-center'>{renderStatus(status[row.key] || 'unknown')}</td>
                  <td className='px-6 py-2'>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type='button'
                          className='flex flex-wrap items-center gap-1 rounded-md px-2 py-1 transition-all-ease hover:bg-gray-100'
                          title={t('models.assign_routes')}
                        >
                          {row.routes.length === 0 ? (
                            <span className='text-gray-300'>—</span>
                          ) : (
                            row.routes.map((route) => (
                              <Badge key={route} variant='secondary'>
                                {t(`router.${route}`)}
                              </Badge>
                            ))
                          )}
                          <Pencil className='h-3 w-3 text-gray-400' />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className='w-56 p-2'>
                        <p className='px-1 pb-2 text-xs font-medium text-gray-500'>{t('models.assign_routes')}</p>
                        <div className='space-y-1'>
                          {ROUTE_KEYS.map((routeKey) => (
                            <label
                              key={routeKey}
                              htmlFor={`${row.key}-${routeKey}`}
                              className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all-ease hover:bg-gray-100'
                            >
                              <Checkbox
                                id={`${row.key}-${routeKey}`}
                                checked={config?.Router?.[routeKey] === row.key}
                                onCheckedChange={(checked) => assignToRoute(routeKey, row.key, checked === true)}
                              />
                              {t(`router.${routeKey}`)}
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </td>
                  <td className='px-6 py-2 text-right'>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => handleTest(row)}
                      disabled={status[row.key] === 'testing' || isTestingAll}
                      className='transition-all-ease hover:scale-[1.05]'
                    >
                      {t('models.test')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
