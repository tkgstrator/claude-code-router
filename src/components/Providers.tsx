import { Pencil, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import type { SubscriptionView } from '@/lib/providers/subscription-view'
import type { CatalogEntry } from '@/schemas/catalog.dto'
import type { Provider, ProviderAuthMode } from '@/types'
import { useConfig } from './ConfigProvider'
import { ProviderList } from './ProviderList'
import { EditProviderDialog } from './providers/EditProviderDialog'
import { ManageProvidersDialog } from './providers/ManageProvidersDialog'
import { ProviderConnectFlow } from './providers/ProviderConnectFlow'

export function Providers() {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const { config, setConfig } = useConfig()
  const [editingProviderIndex, setEditingProviderIndex] = useState<number | null>(null)
  const [hasFetchedModels, setHasFetchedModels] = useState<Record<number, boolean>>({})
  const [providerParamInputs, setProviderParamInputs] = useState<Record<string, { name: string; value: string }>>({})
  const [availableTransformers, setAvailableTransformers] = useState<{ name: string; endpoint: string | null }[]>([])
  const [editingProviderData, setEditingProviderData] = useState<Provider | null>(null)
  const [refreshingTemplates, setRefreshingTemplates] = useState(false)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [manageOpen, setManageOpen] = useState(false)

  const [showApiKey, setShowApiKey] = useState<Record<number, boolean>>({})
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [activeAuthMode, setActiveAuthMode] = useState<ProviderAuthMode>('api_key')

  const [subscriptionByProvider, setSubscriptionByProvider] = useState<Record<string, SubscriptionView>>({})

  const fetchSubscriptions = async () => {
    try {
      const response = await api.get<{ subscriptions: SubscriptionView[] }>('/subscriptions')
      const subMap: Record<string, SubscriptionView> = {}
      for (const entry of response.subscriptions) {
        subMap[entry.providerName] = entry
      }
      setSubscriptionByProvider(subMap)
    } catch (error) {
      console.error('Failed to fetch subscriptions:', error)
    }
  }

  const fetchCatalog = async () => {
    try {
      const res = await api.get<{ entries: CatalogEntry[] }>('/catalog')
      setCatalog(res.entries)
    } catch (err) {
      console.error('Failed to fetch catalog:', err)
    }
  }

  const refreshTemplates = async () => {
    setRefreshingTemplates(true)
    try {
      // Catalog refresh scrapes the vendor pricing pages and updates the
      // process-local overlay. /refresh-models then reflects the fresh
      // prices onto configured Provider rows.
      const [catalogRes] = await Promise.all([
        api.post<{ entries: CatalogEntry[]; scrapedVendors: string[]; warnings: string[] }>('/catalog/refresh', {}),
        api.post<{ outcomes: { provider: string; added: string[]; error?: string }[] }>('/refresh-models', {})
      ])
      const [fresh, syncResult] = await Promise.all([
        api.getConfig(),
        api.post<{ subscriptions: SubscriptionView[] }>('/subscriptions/sync', {})
      ])
      setCatalog(catalogRes.entries)
      setConfig(fresh)
      const subMap: Record<string, SubscriptionView> = {}
      for (const entry of syncResult.subscriptions) {
        subMap[entry.providerName] = entry
      }
      setSubscriptionByProvider(subMap)
    } catch (err) {
      console.error('Failed to refresh:', err)
    } finally {
      setRefreshingTemplates(false)
    }
  }

  // Fetch available transformers when component mounts
  useEffect(() => {
    const fetchTransformers = async () => {
      try {
        const response = await api.get<{ transformers: { name: string; endpoint: string | null }[] }>('/transformers')
        setAvailableTransformers(response.transformers)
      } catch (error) {
        console.error('Failed to fetch transformers:', error)
      }
    }

    fetchTransformers()
    fetchCatalog()
  }, [])

  useEffect(() => {
    fetchSubscriptions()
  }, [config])

  // Handle case where config is null or undefined
  if (!config) {
    return (
      <PageContainer>
        <PageHeader title={t('providers.title')} />
        <PageContent className='flex items-center justify-center'>
          <div className='text-muted-foreground'>Loading providers configuration...</div>
        </PageContent>
      </PageContainer>
    )
  }

  // Validate config.Providers to ensure it's an array
  const validProviders = Array.isArray(config.Providers) ? config.Providers : []

  // Toggle a catalog entry on/off — this only controls whether the
  // vendor row appears on the Providers page. Filling in the api key
  // or running the OAuth flow happens by clicking the row after it's
  // been enabled here; the Manage dialog stays open so the user can
  // flip several vendors in a row.
  const handleToggleCatalog = async (entry: CatalogEntry, checked: boolean) => {
    const newProviders = checked
      ? [
          ...validProviders,
          {
            name: entry.name,
            api_base_url: entry.apiBaseUrl,
            api_key: null,
            auth_mode: entry.authMode,
            // Fresh row lands disabled so the vendor doesn't get called
            // before the user has entered a key / signed in via OAuth.
            // Flip on from the row's Edit dialog after configuring.
            enabled: false,
            models:
              entry.defaultEnabledModels.length > 0
                ? entry.defaultEnabledModels
                : entry.models.filter((m) => !m.deprecated && !m.legacy).map((m) => m.name)
          } satisfies Provider
        ]
      : validProviders.filter((p) => p.name !== entry.name)
    const newConfig = { ...config, Providers: newProviders }
    setConfig(newConfig)
    try {
      await api.updateConfig(newConfig)
      if (entry.authMode === 'subscription') await fetchSubscriptions()
    } catch (err) {
      console.error('Failed to update providers:', err)
    }
  }

  const handleEditProvider = (index: number) => {
    // Find the actual index in the original providers array
    const actualIndex = validProviders.indexOf(visibleProviders[index])
    const provider = config.Providers[actualIndex]
    setEditingProviderIndex(actualIndex)
    setEditingProviderData({ enabled: true, ...JSON.parse(JSON.stringify(provider)) }) // Deep clone
    // Reset API key visibility and error when opening edit dialog
    setShowApiKey((prev) => ({
      ...prev,
      [actualIndex]: false
    }))
    setApiKeyError(null)
    setNameError(null)
  }

  const handleSaveProvider = async () => {
    if (!editingProviderData) return

    // Validate name
    if (!editingProviderData.name || editingProviderData.name.trim() === '') {
      setNameError(t('providers.name_required'))
      return
    }

    // Check for duplicate names (case-insensitive)
    const trimmedName = editingProviderData.name.trim()
    const isDuplicate = config.Providers.some((provider, index) => {
      // Skip checking the current provider being edited
      if (index === editingProviderIndex) {
        return false
      }
      return provider.name.toLowerCase() === trimmedName.toLowerCase()
    })

    if (isDuplicate) {
      setNameError(t('providers.name_duplicate'))
      return
    }

    // Validate API key (api_key providers only, and only when the
    // provider is enabled — a disabled provider has no upstream calls
    // so it's fine to save it with an empty key placeholder).
    const authMode = editingProviderData.auth_mode ?? 'api_key'
    const isEnabled = editingProviderData.enabled !== false
    if (
      authMode === 'api_key' &&
      isEnabled &&
      (!editingProviderData.api_key || editingProviderData.api_key.trim() === '')
    ) {
      setApiKeyError(t('providers.api_key_required'))
      return
    }

    // Clear errors if validation passes
    setApiKeyError(null)
    setNameError(null)

    if (editingProviderIndex !== null && editingProviderData) {
      const newProviders = [...config.Providers]
      newProviders[editingProviderIndex] = editingProviderData
      const newConfig = { ...config, Providers: newProviders }
      setConfig(newConfig)
      await api.updateConfig(newConfig)
      // Post-save probe: hits the vendor's /v1/models (or for
      // subscription providers re-reads the credentials file). No
      // token spend. Shown via the outlet's toast.
      try {
        const probe = await api.post<{ success: boolean; error?: string; latencyMs?: number }>('/providers/test', {
          name: trimmedName
        })
        if (probe.success) {
          showToast(t('providers.connection_successful', { name: trimmedName }), 'success')
        } else {
          showToast(
            `${t('providers.connection_failed', { name: trimmedName })}: ${probe.error ?? 'unknown error'}`,
            'warning'
          )
        }
      } catch (err) {
        showToast(
          `${t('providers.connection_failed', { name: trimmedName })}: ${err instanceof Error ? err.message : 'request failed'}`,
          'warning'
        )
      }
    }
    // Reset API key visibility for this provider
    if (editingProviderIndex !== null) {
      setShowApiKey((prev) => {
        const newState = { ...prev }
        delete newState[editingProviderIndex]
        return newState
      })
    }
    setEditingProviderIndex(null)
    setEditingProviderData(null)
  }

  const handleCancelAddProvider = () => {
    // Reset fetched models state for this provider
    if (editingProviderIndex !== null) {
      setHasFetchedModels((prev) => {
        const newState = { ...prev }
        delete newState[editingProviderIndex]
        return newState
      })
      // Reset API key visibility for this provider
      setShowApiKey((prev) => {
        const newState = { ...prev }
        delete newState[editingProviderIndex]
        return newState
      })
    }
    setEditingProviderIndex(null)
    setEditingProviderData(null)
    setApiKeyError(null)
    setNameError(null)
  }

  const editingProvider =
    editingProviderData || (editingProviderIndex !== null ? validProviders[editingProviderIndex] : null)

  const providersByAuth = {
    api_key: validProviders.filter((p) => (p.auth_mode ?? 'api_key') === 'api_key'),
    subscription: validProviders.filter((p) => p.auth_mode === 'subscription')
  }
  const visibleProviders = providersByAuth[activeAuthMode]
  const isAvailable = (p: Provider) => {
    if (p.enabled === false) return false
    if (p.auth_mode === 'subscription') return subscriptionByProvider[p.name]?.accounts.some((a) => a.enabled) ?? false
    return (p.api_key?.trim().length ?? 0) > 0
  }
  const availableProviders = visibleProviders.filter(isAvailable)
  const unavailableProviders = visibleProviders.filter((p) => !isAvailable(p))

  return (
    <PageContainer>
      <PageHeader
        title={t('providers.title')}
        extra={
          <Tabs value={activeAuthMode} onValueChange={(v) => setActiveAuthMode(v as ProviderAuthMode)}>
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='api_key'>
                {t('providers.auth_api')}
                <span className='ml-2 text-xs text-muted-foreground'>({providersByAuth.api_key.length})</span>
              </TabsTrigger>
              <TabsTrigger value='subscription'>
                {t('providers.auth_subscription')}
                <span className='ml-2 text-xs text-muted-foreground'>({providersByAuth.subscription.length})</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        <Button variant='outline' onClick={refreshTemplates} disabled={refreshingTemplates}>
          <RefreshCw className={`h-4 w-4 ${refreshingTemplates ? 'animate-spin' : ''}`} />
          {t('providers.refresh_templates')}
        </Button>
        <Button variant='outline' onClick={() => setManageOpen(true)}>
          <Pencil className='h-4 w-4' />
          {t('providers.manage')}
        </Button>
        <ProviderConnectFlow onSubscriptionsSynced={fetchSubscriptions} />
      </PageHeader>
      <PageContent>
        {visibleProviders.length === 0 ? (
          <ProviderList providers={visibleProviders} onEdit={handleEditProvider} />
        ) : (
          <div className='space-y-6'>
            {availableProviders.length > 0 && (
              <div className='space-y-2'>
                <h3 className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
                  {t('providers.available')} ({availableProviders.length})
                </h3>
                <ProviderList
                  providers={availableProviders}
                  onEdit={(idx) => handleEditProvider(visibleProviders.indexOf(availableProviders[idx]))}
                />
              </div>
            )}
            {unavailableProviders.length > 0 && (
              <div className='space-y-2'>
                <h3 className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
                  {t('providers.unavailable')} ({unavailableProviders.length})
                </h3>
                <ProviderList
                  providers={unavailableProviders}
                  onEdit={(idx) => handleEditProvider(visibleProviders.indexOf(unavailableProviders[idx]))}
                />
              </div>
            )}
          </div>
        )}
      </PageContent>

      <EditProviderDialog
        provider={editingProvider}
        providerData={editingProviderData}
        open={editingProviderIndex !== null}
        onOpenChange={(open) => {
          if (!open) handleCancelAddProvider()
        }}
        onSave={handleSaveProvider}
        onProviderDataChange={setEditingProviderData}
        showApiKey={editingProviderIndex !== null ? Boolean(showApiKey[editingProviderIndex]) : false}
        onToggleShowApiKey={() => {
          if (editingProviderIndex === null) return
          const index = editingProviderIndex
          setShowApiKey((prev) => ({ ...prev, [index]: !prev[index] }))
        }}
        apiKeyError={apiKeyError}
        subscriptionByProvider={subscriptionByProvider}
        availableTransformers={availableTransformers}
        paramInputs={providerParamInputs}
        onParamInputsChange={setProviderParamInputs}
        hasFetchedModels={editingProviderIndex !== null ? Boolean(hasFetchedModels[editingProviderIndex]) : false}
      />

      <ManageProvidersDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        catalog={catalog}
        activeAuthMode={activeAuthMode}
        validProviders={validProviders}
        onToggleCatalog={handleToggleCatalog}
      />
    </PageContainer>
  )
}
