import { isDeprecatedModel } from '@ccr/shared/data'
import { Eye, EyeOff, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ComboInput } from '@/components/ui/combo-input'
import { Combobox } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { findSubscriptionPreset } from '@/lib/subscriptionPresets'
import type { Provider, ProviderAuthMode } from '@/types'
import { useConfig } from './ConfigProvider'
import { ProviderList } from './ProviderList'

interface ProviderType extends Provider {}

export function Providers() {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const { config, setConfig } = useConfig()
  const [editingProviderIndex, setEditingProviderIndex] = useState<number | null>(null)
  const [hasFetchedModels, setHasFetchedModels] = useState<Record<number, boolean>>({})
  const [providerParamInputs, setProviderParamInputs] = useState<Record<string, { name: string; value: string }>>({})
  const [modelParamInputs, setModelParamInputs] = useState<Record<string, { name: string; value: string }>>({})
  const [availableTransformers, setAvailableTransformers] = useState<{ name: string; endpoint: string | null }[]>([])
  const [editingProviderData, setEditingProviderData] = useState<ProviderType | null>(null)
  const [refreshingTemplates, setRefreshingTemplates] = useState(false)

  const refreshTemplates = async () => {
    setRefreshingTemplates(true)
    try {
      // Ask the server to top each configured provider up from its
      // /v1/models so e.g. claude-opus-4-7 shows up without waiting for
      // llm-prices to catch up
      await api.post<{ outcomes: { provider: string; added: string[]; error?: string }[] }>('/refresh-models', {})
      // Reload config so the new models show up in the UI
      const fresh = await api.getConfig()
      setConfig(fresh)
    } catch (err) {
      console.error('Failed to refresh:', err)
    } finally {
      setRefreshingTemplates(false)
    }
  }
  const [showApiKey, setShowApiKey] = useState<Record<number, boolean>>({})
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [activeAuthMode, setActiveAuthMode] = useState<ProviderAuthMode>('api_key')
  const comboInputRef = useRef<HTMLInputElement>(null)

  const [planByProvider, setPlanByProvider] = useState<Record<string, string | null>>({})

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
  }, [])

  useEffect(() => {
    const fetchSubscriptions = async () => {
      try {
        const response = await api.get<{
          subscriptions: { providerName: string; plan: string | null }[]
        }>('/subscriptions')
        const map: Record<string, string | null> = {}
        for (const entry of response.subscriptions) {
          map[entry.providerName] = entry.plan
        }
        setPlanByProvider(map)
      } catch (error) {
        console.error('Failed to fetch subscriptions:', error)
      }
    }
    fetchSubscriptions()
  }, [config])

  // Handle case where config is null or undefined
  if (!config) {
    return (
      <Card className='flex h-full flex-col border-0 bg-white shadow-none'>
        <CardHeader className='flex flex-row items-center justify-between border-b px-6 py-4'>
          <CardTitle className='text-lg'>{t('providers.title')}</CardTitle>
        </CardHeader>
        <CardContent className='flex-grow flex items-center justify-center px-6 py-4'>
          <div className='text-gray-500'>Loading providers configuration...</div>
        </CardContent>
      </Card>
    )
  }

  // Validate config.Providers to ensure it's an array
  const validProviders = Array.isArray(config.Providers) ? config.Providers : []

  const handleEditProvider = (index: number) => {
    // Find the actual index in the original providers array
    const actualIndex = validProviders.indexOf(visibleProviders[index])
    const provider = config.Providers[actualIndex]
    setEditingProviderIndex(actualIndex)
    setEditingProviderData(JSON.parse(JSON.stringify(provider))) // 深拷贝
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

    // Validate API key (only when this provider uses an api key auth)
    const authMode = editingProviderData.auth_mode ?? 'api_key'
    if (authMode === 'api_key' && (!editingProviderData.api_key || editingProviderData.api_key.trim() === '')) {
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

  const handleProviderChange = (_index: number, field: string, value: string) => {
    if (!editingProviderData) return
    const updatedProvider = { ...editingProviderData, [field]: value }

    // When the API key transitions empty -> non-empty, the model
    // switches flip from "all off (key missing gate)" to "all on minus
    // _disabledModels". Without seeding, deprecated models would all
    // turn on. Materialize the deprecated set into _disabledModels on
    // that edge so they start OFF; from then on it's a normal disabled
    // list the user controls (enabling one removes it and persists).
    if (field === 'api_key') {
      const had = (editingProviderData.api_key?.trim().length ?? 0) > 0
      const has = value.trim().length > 0
      if (!had && has) {
        const models: string[] = Array.isArray(updatedProvider.models) ? updatedProvider.models : []
        const serverDeprecated = Array.isArray(updatedProvider.deprecatedModels) ? updatedProvider.deprecatedModels : []
        const deprecated = models.filter((m) => serverDeprecated.includes(m) || isDeprecatedModel(m))
        if (deprecated.length > 0) {
          const transformer = { ...(updatedProvider.transformer ?? { use: [] }) }
          const existing = Array.isArray(transformer._disabledModels) ? (transformer._disabledModels as string[]) : []
          transformer._disabledModels = [...new Set([...existing, ...deprecated])]
          updatedProvider.transformer = transformer
        }
      }
    }

    setEditingProviderData(updatedProvider)
  }

  const handleProviderTransformerChange = (_index: number, transformerPath: string) => {
    if (!transformerPath || !editingProviderData) return // Don't add empty transformers

    const updatedProvider = { ...editingProviderData }

    if (!updatedProvider.transformer) {
      updatedProvider.transformer = { use: [] }
    }

    // Add transformer to the use array
    updatedProvider.transformer.use = [...updatedProvider.transformer.use, transformerPath]
    setEditingProviderData(updatedProvider)
  }

  const removeProviderTransformerAtIndex = (_index: number, transformerIndex: number) => {
    if (!editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    if (updatedProvider.transformer) {
      const newUseArray = [...updatedProvider.transformer.use]
      newUseArray.splice(transformerIndex, 1)
      updatedProvider.transformer.use = newUseArray

      // If use array is now empty and no other properties, remove transformer entirely
      if (newUseArray.length === 0 && Object.keys(updatedProvider.transformer).length === 1) {
        delete updatedProvider.transformer
      }
    }

    setEditingProviderData(updatedProvider)
  }

  const handleModelTransformerChange = (_providerIndex: number, model: string, transformerPath: string) => {
    if (!transformerPath || !editingProviderData) return // Don't add empty transformers

    const updatedProvider = { ...editingProviderData }

    if (!updatedProvider.transformer) {
      updatedProvider.transformer = { use: [] }
    }

    // Initialize model transformer if it doesn't exist
    if (!updatedProvider.transformer[model]) {
      updatedProvider.transformer[model] = { use: [] }
    }

    // Add transformer to the use array
    updatedProvider.transformer[model].use = [...updatedProvider.transformer[model].use, transformerPath]
    setEditingProviderData(updatedProvider)
  }

  const setApiModelDisabled = (model: string, disabled: boolean) => {
    if (!editingProviderData) return
    const updatedProvider = { ...editingProviderData }
    const transformer = { ...(updatedProvider.transformer ?? { use: [] }) }
    const current = Array.isArray((transformer as Record<string, unknown>)._disabledModels)
      ? [...(transformer as Record<string, string[]>)._disabledModels]
      : []
    const next = (() => {
      if (disabled) {
        return current.includes(model) ? current : [...current, model]
      }
      return current.filter((m) => m !== model)
    })()
    if (next.length === 0) {
      delete (transformer as Record<string, unknown>)._disabledModels
    } else {
      ;(transformer as Record<string, unknown>)._disabledModels = next
    }
    updatedProvider.transformer = transformer
    setEditingProviderData(updatedProvider)
  }

  const toggleSubscriptionModel = (model: string, enabled: boolean) => {
    if (!editingProviderData) return
    const updatedProvider = { ...editingProviderData }
    const current = Array.isArray(updatedProvider.models) ? [...updatedProvider.models] : []
    if (enabled) {
      if (!current.includes(model)) current.push(model)
    } else {
      const idx = current.indexOf(model)
      if (idx >= 0) current.splice(idx, 1)
    }
    updatedProvider.models = current
    if (!enabled && updatedProvider.transformer && updatedProvider.transformer[model]) {
      const nextTransformer = { ...updatedProvider.transformer }
      delete nextTransformer[model]
      updatedProvider.transformer = nextTransformer
    }
    setEditingProviderData(updatedProvider)
  }

  const setModelTransformers = (model: string, names: string[]) => {
    if (!editingProviderData) return
    const updatedProvider = { ...editingProviderData }
    if (!updatedProvider.transformer) {
      updatedProvider.transformer = { use: [] }
    }
    const existing = updatedProvider.transformer[model]?.use ?? []
    const byName = new Map<string, string | (string | Record<string, unknown> | { max_tokens: number })[]>()
    for (const entry of existing) {
      const name = typeof entry === 'string' ? entry : String((entry as Array<unknown>)[0])
      byName.set(name, entry)
    }
    const newUse = names.map((name) => byName.get(name) ?? name)
    if (newUse.length === 0) {
      delete updatedProvider.transformer[model]
    } else {
      updatedProvider.transformer[model] = { ...(updatedProvider.transformer[model] ?? {}), use: newUse }
    }
    setEditingProviderData(updatedProvider)
  }

  const removeModelTransformerAtIndex = (_providerIndex: number, model: string, transformerIndex: number) => {
    if (!editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    if (updatedProvider.transformer && updatedProvider.transformer[model]) {
      const newUseArray = [...updatedProvider.transformer[model].use]
      newUseArray.splice(transformerIndex, 1)
      updatedProvider.transformer[model].use = newUseArray

      // If use array is now empty and no other properties, remove model transformer entirely
      if (newUseArray.length === 0 && Object.keys(updatedProvider.transformer[model]).length === 1) {
        delete updatedProvider.transformer[model]
      }
    }

    setEditingProviderData(updatedProvider)
  }

  const addProviderTransformerParameter = (
    _providerIndex: number,
    transformerIndex: number,
    paramName: string,
    paramValue: string
  ) => {
    if (!editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    if (!updatedProvider.transformer) {
      updatedProvider.transformer = { use: [] }
    }

    // Add parameter to the specified transformer in use array
    if (updatedProvider.transformer.use && updatedProvider.transformer.use.length > transformerIndex) {
      const targetTransformer = updatedProvider.transformer.use[transformerIndex]

      // If it's already an array with parameters, update it
      if (Array.isArray(targetTransformer)) {
        const transformerArray = [...targetTransformer]
        // Check if the second element is an object (parameters object)
        if (transformerArray.length > 1 && typeof transformerArray[1] === 'object' && transformerArray[1] !== null) {
          // Update the existing parameters object
          const existingParams = transformerArray[1] as Record<string, unknown>
          const paramsObj: Record<string, unknown> = { ...existingParams, [paramName]: paramValue }
          transformerArray[1] = paramsObj
        } else if (transformerArray.length > 1) {
          // If there are other elements, add the parameters object
          const paramsObj = { [paramName]: paramValue }
          transformerArray.splice(1, transformerArray.length - 1, paramsObj)
        } else {
          // Add a new parameters object
          const paramsObj = { [paramName]: paramValue }
          transformerArray.push(paramsObj)
        }

        updatedProvider.transformer.use[transformerIndex] = transformerArray as
          | string
          | (string | Record<string, unknown> | { max_tokens: number })[]
      } else {
        // Convert to array format with parameters
        const paramsObj = { [paramName]: paramValue }
        updatedProvider.transformer.use[transformerIndex] = [targetTransformer as string, paramsObj]
      }
    }

    setEditingProviderData(updatedProvider)
  }

  const removeProviderTransformerParameterAtIndex = (
    _providerIndex: number,
    transformerIndex: number,
    paramName: string
  ) => {
    if (!editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    if (!updatedProvider.transformer?.use || updatedProvider.transformer.use.length <= transformerIndex) {
      return
    }

    const targetTransformer = updatedProvider.transformer.use[transformerIndex]
    if (Array.isArray(targetTransformer) && targetTransformer.length > 1) {
      const transformerArray = [...targetTransformer]
      // Check if the second element is an object (parameters object)
      if (typeof transformerArray[1] === 'object' && transformerArray[1] !== null) {
        const paramsObj = { ...(transformerArray[1] as Record<string, unknown>) }
        delete paramsObj[paramName]

        // If the parameters object is now empty, remove it
        if (Object.keys(paramsObj).length === 0) {
          transformerArray.splice(1, 1)
        } else {
          transformerArray[1] = paramsObj
        }

        updatedProvider.transformer.use[transformerIndex] = transformerArray
        setEditingProviderData(updatedProvider)
      }
    }
  }

  const addModelTransformerParameter = (
    _providerIndex: number,
    model: string,
    transformerIndex: number,
    paramName: string,
    paramValue: string
  ) => {
    if (!editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    if (!updatedProvider.transformer) {
      updatedProvider.transformer = { use: [] }
    }

    if (!updatedProvider.transformer[model]) {
      updatedProvider.transformer[model] = { use: [] }
    }

    // Add parameter to the specified transformer in use array
    if (updatedProvider.transformer[model].use && updatedProvider.transformer[model].use.length > transformerIndex) {
      const targetTransformer = updatedProvider.transformer[model].use[transformerIndex]

      // If it's already an array with parameters, update it
      if (Array.isArray(targetTransformer)) {
        const transformerArray = [...targetTransformer]
        // Check if the second element is an object (parameters object)
        if (transformerArray.length > 1 && typeof transformerArray[1] === 'object' && transformerArray[1] !== null) {
          // Update the existing parameters object
          const existingParams = transformerArray[1] as Record<string, unknown>
          const paramsObj: Record<string, unknown> = { ...existingParams, [paramName]: paramValue }
          transformerArray[1] = paramsObj
        } else if (transformerArray.length > 1) {
          // If there are other elements, add the parameters object
          const paramsObj = { [paramName]: paramValue }
          transformerArray.splice(1, transformerArray.length - 1, paramsObj)
        } else {
          // Add a new parameters object
          const paramsObj = { [paramName]: paramValue }
          transformerArray.push(paramsObj)
        }

        updatedProvider.transformer[model].use[transformerIndex] = transformerArray as
          | string
          | (string | Record<string, unknown> | { max_tokens: number })[]
      } else {
        // Convert to array format with parameters
        const paramsObj = { [paramName]: paramValue }
        updatedProvider.transformer[model].use[transformerIndex] = [targetTransformer as string, paramsObj]
      }
    }

    setEditingProviderData(updatedProvider)
  }

  const removeModelTransformerParameterAtIndex = (
    _providerIndex: number,
    model: string,
    transformerIndex: number,
    paramName: string
  ) => {
    if (!editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    if (
      !updatedProvider.transformer?.[model]?.use ||
      updatedProvider.transformer[model].use.length <= transformerIndex
    ) {
      return
    }

    const targetTransformer = updatedProvider.transformer[model].use[transformerIndex]
    if (Array.isArray(targetTransformer) && targetTransformer.length > 1) {
      const transformerArray = [...targetTransformer]
      // Check if the second element is an object (parameters object)
      if (typeof transformerArray[1] === 'object' && transformerArray[1] !== null) {
        const paramsObj = { ...(transformerArray[1] as Record<string, unknown>) }
        delete paramsObj[paramName]

        // If the parameters object is now empty, remove it
        if (Object.keys(paramsObj).length === 0) {
          transformerArray.splice(1, 1)
        } else {
          transformerArray[1] = paramsObj
        }

        updatedProvider.transformer[model].use[transformerIndex] = transformerArray
        setEditingProviderData(updatedProvider)
      }
    }
  }

  const handleAddModel = (_index: number, model: string) => {
    if (!model.trim() || !editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    // Handle case where provider.models might be null or undefined
    const models = Array.isArray(updatedProvider.models) ? [...updatedProvider.models] : []

    // Check if model already exists
    if (!models.includes(model.trim())) {
      models.push(model.trim())
      updatedProvider.models = models
      setEditingProviderData(updatedProvider)
    }
  }

  const handleRemoveModel = (_providerIndex: number, modelIndex: number) => {
    if (!editingProviderData) return

    const updatedProvider = { ...editingProviderData }

    // Handle case where provider.models might be null or undefined
    const models = Array.isArray(updatedProvider.models) ? [...updatedProvider.models] : []

    // Handle case where modelIndex might be out of bounds
    if (modelIndex >= 0 && modelIndex < models.length) {
      models.splice(modelIndex, 1)
      updatedProvider.models = models
      setEditingProviderData(updatedProvider)
    }
  }

  const editingProvider =
    editingProviderData || (editingProviderIndex !== null ? validProviders[editingProviderIndex] : null)

  const providersByAuth = {
    api_key: validProviders.filter((p) => (p.auth_mode ?? 'api_key') === 'api_key'),
    subscription: validProviders.filter((p) => p.auth_mode === 'subscription')
  }
  const visibleProviders = providersByAuth[activeAuthMode]
  const isAvailable = (p: Provider) => {
    if (p.auth_mode === 'subscription') return Boolean(planByProvider[p.name])
    return (p.api_key?.trim().length ?? 0) > 0
  }
  const availableProviders = visibleProviders.filter(isAvailable)
  const unavailableProviders = visibleProviders.filter((p) => !isAvailable(p))

  return (
    <Card className='flex h-full flex-col border-0 bg-white shadow-none'>
      <CardHeader className='flex flex-col border-b px-6 py-4 gap-3'>
        <div className='flex flex-row items-center justify-between'>
          <CardTitle className='text-lg'>{t('providers.title')}</CardTitle>
          <div className='flex items-center gap-2'>
            <Button variant='outline' onClick={refreshTemplates} disabled={refreshingTemplates}>
              <RefreshCw className={`h-4 w-4 ${refreshingTemplates ? 'animate-spin' : ''}`} />
              {t('providers.refresh_templates')}
            </Button>
          </div>
        </div>
        <Tabs value={activeAuthMode} onValueChange={(v) => setActiveAuthMode(v as ProviderAuthMode)}>
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='api_key'>
              {t('providers.auth_api')}
              <span className='ml-2 text-xs text-gray-500'>({providersByAuth.api_key.length})</span>
            </TabsTrigger>
            <TabsTrigger value='subscription'>
              {t('providers.auth_subscription')}
              <span className='ml-2 text-xs text-gray-500'>({providersByAuth.subscription.length})</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className='flex-grow overflow-y-auto px-6 py-4'>
        {visibleProviders.length === 0 ? (
          <ProviderList providers={visibleProviders} onEdit={handleEditProvider} />
        ) : (
          <div className='space-y-6'>
            {availableProviders.length > 0 && (
              <div className='space-y-2'>
                <h3 className='text-xs font-medium uppercase tracking-wider text-gray-500'>
                  {t('providers.available')} ({availableProviders.length})
                </h3>
                <ProviderList
                  providers={availableProviders}
                  planByProvider={planByProvider}
                  onEdit={(idx) => handleEditProvider(visibleProviders.indexOf(availableProviders[idx]))}
                />
              </div>
            )}
            {unavailableProviders.length > 0 && (
              <div className='space-y-2'>
                <h3 className='text-xs font-medium uppercase tracking-wider text-gray-500'>
                  {t('providers.unavailable')} ({unavailableProviders.length})
                </h3>
                <ProviderList
                  providers={unavailableProviders}
                  planByProvider={planByProvider}
                  onEdit={(idx) => handleEditProvider(visibleProviders.indexOf(unavailableProviders[idx]))}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog
        open={editingProviderIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            handleCancelAddProvider()
          }
        }}
      >
        <DialogContent className='max-h-[80vh] flex flex-col sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('providers.edit')}</DialogTitle>
            <DialogDescription>{t('providers.edit_description')}</DialogDescription>
          </DialogHeader>
          {editingProvider && editingProviderIndex !== null && (
            <div className='space-y-4 p-4 overflow-y-auto flex-grow'>
              {(editingProvider.auth_mode ?? 'api_key') === 'api_key' ? (
                <div className='space-y-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='api_base_url'>{t('providers.api_base_url')}</Label>
                    <Input
                      id='api_base_url'
                      value={editingProvider.api_base_url || ''}
                      onChange={(e) => handleProviderChange(editingProviderIndex, 'api_base_url', e.target.value)}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='api_key'>{t('providers.api_key')}</Label>
                    <div className='relative'>
                      <Input
                        id='api_key'
                        type={showApiKey[editingProviderIndex || 0] ? 'text' : 'password'}
                        value={editingProvider.api_key || ''}
                        onChange={(e) => handleProviderChange(editingProviderIndex, 'api_key', e.target.value)}
                        className={apiKeyError ? 'border-red-500' : ''}
                      />
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='absolute right-2 top-1/2 transform -translate-y-1/2 h-8 w-8'
                        onClick={() => {
                          const index = editingProviderIndex || 0
                          setShowApiKey((prev) => ({
                            ...prev,
                            [index]: !prev[index]
                          }))
                        }}
                      >
                        {showApiKey[editingProviderIndex || 0] ? (
                          <EyeOff className='h-4 w-4' />
                        ) : (
                          <Eye className='h-4 w-4' />
                        )}
                      </Button>
                    </div>
                    {apiKeyError && <p className='text-sm text-red-500'>{apiKeyError}</p>}
                  </div>
                </div>
              ) : (
                (() => {
                  const preset = findSubscriptionPreset(editingProvider)
                  const vendor = preset?.vendor ?? 'subscription'
                  const cli = preset?.cli ?? ''
                  const credentialsPath = preset?.credentialsPath ?? ''
                  return (
                    <div className='rounded-md border bg-muted/40 p-4 text-sm text-gray-700 space-y-2'>
                      <p className='font-medium'>{t('providers.subscription_intro', { vendor, cli })}</p>
                      <p className='text-gray-500'>{t('providers.subscription_hint', { credentialsPath })}</p>
                    </div>
                  )
                })()
              )}
              {(editingProvider.auth_mode ?? 'api_key') === 'api_key' ? (
                <div className='space-y-4'>
                  {/* Provider Transformer Selection */}
                  <div className='space-y-2'>
                    <Label>{t('providers.provider_transformer')}</Label>

                    {/* Add new transformer */}
                    <div className='flex gap-2'>
                      <Combobox
                        options={availableTransformers.map((t) => ({
                          label: t.name,
                          value: t.name
                        }))}
                        value=''
                        onChange={(value) => {
                          if (editingProviderIndex !== null) {
                            handleProviderTransformerChange(editingProviderIndex, value)
                          }
                        }}
                        placeholder={t('providers.select_transformer')}
                        emptyPlaceholder={t('providers.no_transformers')}
                      />
                    </div>

                    {/* Display existing transformers */}
                    {editingProvider.transformer?.use && editingProvider.transformer.use.length > 0 && (
                      <div className='space-y-2 mt-2'>
                        <div className='text-sm font-medium text-gray-700'>{t('providers.selected_transformers')}</div>
                        {editingProvider.transformer.use.map(
                          (
                            transformer: string | (string | Record<string, unknown> | { max_tokens: number })[],
                            transformerIndex: number
                          ) => (
                            <div key={transformerIndex} className='border rounded-md p-3'>
                              <div className='flex gap-2 items-center mb-2'>
                                <div className='flex-1 bg-gray-50 rounded p-2 text-sm'>
                                  {typeof transformer === 'string'
                                    ? transformer
                                    : Array.isArray(transformer)
                                      ? String(transformer[0])
                                      : String(transformer)}
                                </div>
                                <Button
                                  variant='outline'
                                  size='icon'
                                  onClick={() => {
                                    if (editingProviderIndex !== null) {
                                      removeProviderTransformerAtIndex(editingProviderIndex, transformerIndex)
                                    }
                                  }}
                                >
                                  <Trash2 className='h-4 w-4' />
                                </Button>
                              </div>

                              {/* Transformer-specific Parameters */}
                              <div className='mt-2 pl-4 border-l-2 border-gray-200'>
                                <Label className='text-sm'>{t('providers.transformer_parameters')}</Label>
                                <div className='space-y-2 mt-1'>
                                  <div className='flex gap-2'>
                                    <Input
                                      placeholder={t('providers.parameter_name')}
                                      value={
                                        providerParamInputs[
                                          `provider-${editingProviderIndex}-transformer-${transformerIndex}`
                                        ]?.name || ''
                                      }
                                      onChange={(e) => {
                                        const key = `provider-${editingProviderIndex}-transformer-${transformerIndex}`
                                        setProviderParamInputs((prev) => ({
                                          ...prev,
                                          [key]: {
                                            ...(prev[key] || { name: '', value: '' }),
                                            name: e.target.value
                                          }
                                        }))
                                      }}
                                    />
                                    <Input
                                      placeholder={t('providers.parameter_value')}
                                      value={
                                        providerParamInputs[
                                          `provider-${editingProviderIndex}-transformer-${transformerIndex}`
                                        ]?.value || ''
                                      }
                                      onChange={(e) => {
                                        const key = `provider-${editingProviderIndex}-transformer-${transformerIndex}`
                                        setProviderParamInputs((prev) => ({
                                          ...prev,
                                          [key]: {
                                            ...(prev[key] || { name: '', value: '' }),
                                            value: e.target.value
                                          }
                                        }))
                                      }}
                                    />
                                    <Button
                                      size='sm'
                                      onClick={() => {
                                        if (editingProviderIndex !== null) {
                                          const key = `provider-${editingProviderIndex}-transformer-${transformerIndex}`
                                          const paramInput = providerParamInputs[key]
                                          if (paramInput && paramInput.name && paramInput.value) {
                                            addProviderTransformerParameter(
                                              editingProviderIndex,
                                              transformerIndex,
                                              paramInput.name,
                                              paramInput.value
                                            )
                                            setProviderParamInputs((prev) => ({
                                              ...prev,
                                              [key]: { name: '', value: '' }
                                            }))
                                          }
                                        }
                                      }}
                                    >
                                      <Plus className='h-4 w-4' />
                                    </Button>
                                  </div>

                                  {/* Display existing parameters for this transformer */}
                                  {(() => {
                                    // Get parameters for this specific transformer
                                    if (
                                      !editingProvider.transformer?.use ||
                                      editingProvider.transformer.use.length <= transformerIndex
                                    ) {
                                      return null
                                    }

                                    const targetTransformer = editingProvider.transformer.use[transformerIndex]
                                    let params = {}

                                    if (Array.isArray(targetTransformer) && targetTransformer.length > 1) {
                                      // Check if the second element is an object (parameters object)
                                      if (typeof targetTransformer[1] === 'object' && targetTransformer[1] !== null) {
                                        params = targetTransformer[1] as Record<string, unknown>
                                      }
                                    }

                                    return Object.keys(params).length > 0 ? (
                                      <div className='space-y-1'>
                                        {Object.entries(params).map(([key, value]) => (
                                          <div
                                            key={key}
                                            className='flex items-center justify-between bg-gray-50 rounded p-2'
                                          >
                                            <div className='text-sm'>
                                              <span className='font-medium'>{key}:</span> {String(value)}
                                            </div>
                                            <Button
                                              variant='ghost'
                                              size='sm'
                                              className='h-6 w-6 p-0'
                                              onClick={() => {
                                                if (editingProviderIndex !== null) {
                                                  // We need a function to remove parameters from a specific transformer
                                                  removeProviderTransformerParameterAtIndex(
                                                    editingProviderIndex,
                                                    transformerIndex,
                                                    key
                                                  )
                                                }
                                              }}
                                            >
                                              <X className='h-3 w-3' />
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null
                                  })()}
                                </div>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='models'>{t('providers.models')}</Label>
                    <div className='space-y-2'>
                      <div className='flex gap-2'>
                        <div className='flex-1'>
                          {hasFetchedModels[editingProviderIndex] ? (
                            <ComboInput
                              ref={comboInputRef}
                              options={(editingProvider.models || []).map((model: string) => ({
                                label: model,
                                value: model
                              }))}
                              value=''
                              onChange={() => {
                                // 只更新输入值，不添加模型
                              }}
                              onEnter={(value) => {
                                if (editingProviderIndex !== null) {
                                  handleAddModel(editingProviderIndex, value)
                                }
                              }}
                              inputPlaceholder={t('providers.models_placeholder')}
                            />
                          ) : (
                            <Input
                              id='models'
                              placeholder={t('providers.models_placeholder')}
                              onKeyDown={(e) => {
                                if (
                                  e.key === 'Enter' &&
                                  e.currentTarget.value.trim() &&
                                  editingProviderIndex !== null
                                ) {
                                  handleAddModel(editingProviderIndex, e.currentTarget.value)
                                  e.currentTarget.value = ''
                                }
                              }}
                            />
                          )}
                        </div>
                        <Button
                          onClick={() => {
                            if (hasFetchedModels[editingProviderIndex] && comboInputRef.current) {
                              // 使用ComboInput的逻辑
                              const comboInput = comboInputRef.current as unknown as {
                                getCurrentValue(): string
                                clearInput(): void
                              }
                              const currentValue = comboInput.getCurrentValue()
                              if (currentValue && currentValue.trim() && editingProviderIndex !== null) {
                                handleAddModel(editingProviderIndex, currentValue.trim())
                                // 清空ComboInput
                                comboInput.clearInput()
                              }
                            } else {
                              // 使用普通Input的逻辑
                              const input = document.getElementById('models') as HTMLInputElement
                              if (input && input.value.trim() && editingProviderIndex !== null) {
                                handleAddModel(editingProviderIndex, input.value)
                                input.value = ''
                              }
                            }
                          }}
                        >
                          {t('providers.add_model')}
                        </Button>
                        {/* <Button 
                      onClick={() => editingProvider && fetchAvailableModels(editingProvider)}
                      disabled={isFetchingModels}
                      variant="outline"
                    >
                      {isFetchingModels ? t("providers.fetching_models") : t("providers.fetch_available_models")}
                    </Button> */}
                      </div>
                      <div className='divide-y rounded-md border'>
                        {[...(editingProvider.models || [])]
                          .sort((a: string, b: string) => b.localeCompare(a))
                          .map((model: string) => {
                            const currentNames = (
                              (editingProvider.transformer?.[model]?.use ?? []) as Array<unknown>
                            ).map((entry) => (typeof entry === 'string' ? entry : String((entry as Array<unknown>)[0])))
                            const apiKeyMissing = (editingProvider.api_key?.trim().length ?? 0) === 0
                            const disabledList = Array.isArray(
                              (editingProvider.transformer as Record<string, unknown> | undefined)?._disabledModels
                            )
                              ? (editingProvider.transformer as Record<string, string[]>)._disabledModels
                              : []
                            const modelDisabled = disabledList.includes(model)
                            return (
                              <div key={model} className='flex items-center gap-3 px-3 py-2'>
                                <Switch
                                  checked={!apiKeyMissing && !modelDisabled}
                                  disabled={apiKeyMissing}
                                  onCheckedChange={(checked) => setApiModelDisabled(model, !checked)}
                                />
                                <span className='font-medium text-sm flex-1 min-w-0 truncate'>{model}</span>
                                <div className='w-64'>
                                  <MultiCombobox
                                    options={availableTransformers.map((t) => ({ label: t.name, value: t.name }))}
                                    value={currentNames}
                                    onChange={(names) => setModelTransformers(model, names)}
                                    placeholder={t('providers.select_transformer')}
                                    emptyPlaceholder={t('providers.no_transformers')}
                                  />
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                (() => {
                  const preset = findSubscriptionPreset(editingProvider)
                  if (!preset) return null
                  const enabledModels = new Set(editingProvider.models ?? [])
                  return (
                    <div className='space-y-2'>
                      <Label>{t('providers.models')}</Label>
                      <div className='divide-y rounded-md border'>
                        {[...preset.availableModels]
                          .sort((a, b) => b.localeCompare(a))
                          .map((model) => {
                            const enabled = enabledModels.has(model)
                            const currentNames = (
                              (editingProvider.transformer?.[model]?.use ?? []) as Array<unknown>
                            ).map((entry) => (typeof entry === 'string' ? entry : String((entry as Array<unknown>)[0])))
                            return (
                              <div key={model} className='flex items-center gap-3 px-3 py-2'>
                                <Switch
                                  checked={enabled}
                                  onCheckedChange={(checked) => toggleSubscriptionModel(model, checked)}
                                />
                                <span className='font-medium text-sm flex-1 min-w-0 truncate'>{model}</span>
                                <div className='w-64'>
                                  <MultiCombobox
                                    options={availableTransformers.map((t) => ({ label: t.name, value: t.name }))}
                                    value={currentNames}
                                    onChange={(names) => setModelTransformers(model, names)}
                                    placeholder={t('providers.select_transformer')}
                                    emptyPlaceholder={t('providers.no_transformers')}
                                  />
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )
                })()
              )}
            </div>
          )}
          <div className='space-y-3 mt-auto'>
            <div className='flex justify-end gap-2'>
              {/* <Button 
                variant="outline" 
                onClick={() => editingProvider && testConnectivity(editingProvider)}
                disabled={isTestingConnectivity || !editingProvider}
              >
                <Wifi className="mr-2 h-4 w-4" />
                {isTestingConnectivity ? t("providers.testing") : t("providers.test_connectivity")}
              </Button> */}
              <Button onClick={handleSaveProvider}>{t('app.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
