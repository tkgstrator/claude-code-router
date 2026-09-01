/**
 * Providers — "where requests can go", as one master-detail screen.
 *
 * Absorbs Providers + Subscriptions + ModelsDashboard + the transformer
 * editor. Those were four top-level entries for one decision, which is why
 * an operator had to visit three of them to answer "can this vendor serve
 * this model right now".
 */
import type { TFunction } from 'i18next'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { refreshPrices, removeProvider, saveApiKey, syncModels, testModels, toggleModel } from './actions'
import { disabledModelsOf, enabledCountOf, listedModelsOf, providerState } from './derive'
import { ProviderDetail } from './ProviderDetail'
import { ProviderRail, type RailProvider } from './ProviderRail'
import type { CatalogEntry, Provider } from './types'
import { type ProvidersData, useProvidersData } from './useProvidersData'
import { vendorBrand, vendorLabel } from './vendor-labels'

const findCatalog = (catalog: CatalogEntry[], name: string): CatalogEntry | undefined =>
  catalog.find((e) => e.name === name)

const labelFor = (entry: CatalogEntry | undefined, name: string): string =>
  entry === undefined ? name : vendorLabel(entry.name, entry.displayName)

/** A provider with no catalog entry is a hand-added one — name the host it calls. */
const vendorFor = (entry: CatalogEntry | undefined, p: Provider): string =>
  entry === undefined ? new URL(p.api_base_url).hostname : vendorBrand(entry.name, entry.vendor)

function buildRail(data: ProvidersData): RailProvider[] {
  return data.providers.map((provider) => {
    const entry = findCatalog(data.catalog, provider.name)
    const subscription = data.subscriptions.get(provider.name)
    return {
      provider,
      label: labelFor(entry, provider.name),
      vendor: vendorFor(entry, provider),
      state: providerState(provider, subscription),
      subscription
    }
  })
}

function summarySubtitle(data: ProvidersData, t: TFunction): string {
  const providers = data.counts === null ? data.providers.length : data.counts.providers
  const models =
    data.counts === null ? data.providers.reduce((sum, p) => sum + enabledCountOf(p), 0) : data.counts.enabledModels
  const accounts = [...data.subscriptions.values()].reduce((sum, s) => sum + s.accounts.length, 0)
  return t('providers.screen.summarySubtitle', { providers, models, accounts })
}

export function ProvidersScreen() {
  const { t } = useTranslation()
  const { name } = useParams<{ name?: string }>()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useProvidersData()
  const [busy, setBusy] = useState(false)

  // Every mutation is a write-then-reread: the server derives model rows,
  // prices and test status, so the response body is never the whole truth
  // about what changed.
  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true)
      try {
        await work()
        await reload()
      } finally {
        setBusy(false)
      }
    },
    [reload]
  )

  const rail = data === null ? [] : buildRail(data)
  const selected = name === undefined ? rail[0] : rail.find((e) => e.provider.name === name)
  const goAdd = useCallback(() => navigate('/providers/connect'), [navigate])

  const subtitle = (() => {
    if (data === null) return undefined
    if (selected === undefined) return summarySubtitle(data, t)
    const p = selected.provider
    if (p.auth_mode === 'subscription') return summarySubtitle(data, t)
    return t('providers.screen.apiKeySubtitle', {
      label: selected.label,
      enabled: enabledCountOf(p),
      total: listedModelsOf(p).length
    })
  })()

  return (
    <Screen
      title={t('providers.screen.title')}
      subtitle={subtitle}
      actions={
        <>
          <RButton
            variant='ghost'
            icon='ri-price-tag-3-line'
            onClick={() => run(refreshPrices)}
            disabled={busy || loading}
          >
            {t('providers.screen.refreshPrices')}
          </RButton>
          <RButton variant='primary' icon='ri-add-line' onClick={goAdd}>
            {t('providers.screen.addProvider')}
          </RButton>
        </>
      }
    >
      {error !== null ? (
        <div className='px-6 py-6 text-xs text-destructive'>{error}</div>
      ) : data === null ? (
        <div className='px-6 py-6 text-xs text-muted-foreground'>{t('common.loading')}</div>
      ) : (
        <div className='grid h-full grid-cols-[18rem_1fr]'>
          <ProviderRail
            entries={rail}
            activeName={selected === undefined ? null : selected.provider.name}
            quota={data.quota}
            onAdd={goAdd}
          />
          {selected === undefined ? (
            <div className='px-6 py-6 text-xs text-muted-foreground'>{t('providers.screen.emptyRail')}</div>
          ) : (
            <ProviderDetail
              provider={selected.provider}
              label={selected.label}
              state={selected.state}
              subscription={selected.subscription}
              catalogEntry={findCatalog(data.catalog, selected.provider.name)}
              transformers={data.transformers}
              quota={data.quota}
              now={data.now}
              busy={busy}
              onToggleModel={(model, next) => run(() => toggleModel(selected.provider, model, next))}
              onSaveKey={(key) => run(() => saveApiKey(selected.provider, key))}
              onTestAll={() => {
                const off = new Set(disabledModelsOf(selected.provider))
                const enabled = listedModelsOf(selected.provider).filter((m) => !off.has(m))
                run(() => testModels(selected.provider.name, enabled))
              }}
              onSync={() => run(syncModels)}
              onRemove={() =>
                run(async () => {
                  await removeProvider(selected.provider.name)
                  navigate('/providers')
                })
              }
            />
          )}
        </div>
      )}
    </Screen>
  )
}
