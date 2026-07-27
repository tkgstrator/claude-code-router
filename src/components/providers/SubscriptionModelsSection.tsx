import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Switch } from '@/components/ui/switch'
import { setModelDisabled, setModelTransformerUse } from '@/lib/providers/provider-edits'
import { findSubscriptionPreset } from '@/shared/data'
import type { Provider } from '@/types'

interface SubscriptionModelsSectionProps {
  provider: Provider
  providerData: Provider | null
  onProviderDataChange: (next: Provider) => void
  availableTransformers: { name: string; endpoint: string | null }[]
}

// Models list for a subscription provider: toggle a model on/off and
// pick per-model transformers. The toggle list is derived from the DB
// (`provider.models`) so ids added by the runtime price scrape surface
// automatically; the preset only supplies a denylist for models the
// vendor's subscription backend refuses to serve.
export function SubscriptionModelsSection({
  provider,
  providerData,
  onProviderDataChange,
  availableTransformers
}: SubscriptionModelsSectionProps) {
  const { t } = useTranslation()
  const preset = findSubscriptionPreset(provider)
  if (!preset) return null
  const excluded = new Set(preset.excludedModels)
  const rawDisabled = (provider.transformer as Record<string, unknown> | undefined)?._disabledModels
  const disabledSet = new Set(Array.isArray(rawDisabled) ? (rawDisabled as string[]) : [])
  const models = [...new Set(provider.models)].filter((m) => !excluded.has(m))

  const handleSetModelDisabled = (model: string, disabled: boolean) => {
    if (!providerData) return
    onProviderDataChange(setModelDisabled(providerData, model, disabled))
  }

  const handleSetModelTransformers = (model: string, names: string[]) => {
    if (!providerData) return
    onProviderDataChange(setModelTransformerUse(providerData, model, names))
  }

  return (
    <div className='space-y-2'>
      <Label>{t('providers.models')}</Label>
      <div className='divide-y border-y empty:border-none'>
        {models
          .sort((a, b) => b.localeCompare(a))
          .map((model) => {
            const enabled = !disabledSet.has(model)
            const currentNames = ((provider.transformer?.[model]?.use ?? []) as Array<unknown>).map((entry) =>
              typeof entry === 'string' ? entry : String((entry as Array<unknown>)[0])
            )
            return (
              <div key={model} className='flex items-center gap-3 px-3 py-2'>
                <Switch checked={enabled} onCheckedChange={(checked) => handleSetModelDisabled(model, !checked)} />
                <span className='font-medium text-sm flex-1 min-w-0 truncate'>{model}</span>
                <div className='w-64'>
                  <MultiCombobox
                    options={availableTransformers.map((tr) => ({ label: tr.name, value: tr.name }))}
                    value={currentNames}
                    onChange={(names) => handleSetModelTransformers(model, names)}
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
}
