import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Switch } from '@/components/ui/switch'
import { setModelEnabled, setModelTransformerUse } from '@/lib/providers/provider-edits'
import { findSubscriptionPreset } from '@/shared/data'
import type { Provider } from '@/types'

interface SubscriptionModelsSectionProps {
  provider: Provider
  providerData: Provider | null
  onProviderDataChange: (next: Provider) => void
  availableTransformers: { name: string; endpoint: string | null }[]
}

// Models list for a subscription provider: toggle a preset model on/off
// and pick per-model transformers. Unlike the api_key list, the catalog
// of available models comes from the vendor preset, not user input.
export function SubscriptionModelsSection({
  provider,
  providerData,
  onProviderDataChange,
  availableTransformers
}: SubscriptionModelsSectionProps) {
  const { t } = useTranslation()
  const preset = findSubscriptionPreset(provider)
  if (!preset) return null
  const enabledModels = new Set(provider.models ?? [])

  const handleToggleModel = (model: string, enabled: boolean) => {
    if (!providerData) return
    onProviderDataChange(setModelEnabled(providerData, model, enabled))
  }

  const handleSetModelTransformers = (model: string, names: string[]) => {
    if (!providerData) return
    onProviderDataChange(setModelTransformerUse(providerData, model, names))
  }

  return (
    <div className='space-y-2'>
      <Label>{t('providers.models')}</Label>
      <div className='divide-y rounded-md border'>
        {[...preset.availableModels]
          .sort((a, b) => b.localeCompare(a))
          .map((model) => {
            const enabled = enabledModels.has(model)
            const currentNames = ((provider.transformer?.[model]?.use ?? []) as Array<unknown>).map((entry) =>
              typeof entry === 'string' ? entry : String((entry as Array<unknown>)[0])
            )
            return (
              <div key={model} className='flex items-center gap-3 px-3 py-2'>
                <Switch checked={enabled} onCheckedChange={(checked) => handleToggleModel(model, checked)} />
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
