import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ComboInput } from '@/components/ui/combo-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Switch } from '@/components/ui/switch'
import { addProviderModel, setModelDisabled, setModelTransformerUse } from '@/lib/providers/provider-edits'
import type { Provider } from '@/types'

interface ApiKeyModelsSectionProps {
  providerData: Provider | null
  onProviderDataChange: (next: Provider) => void
  hasFetchedModels: boolean
  models: string[]
  apiKey: string | null
  transformer: Provider['transformer']
  availableTransformers: { name: string; endpoint: string | null }[]
}

// Models list for an api_key provider: add a model, then toggle it on/off
// and pick per-model transformers.
export function ApiKeyModelsSection({
  providerData,
  onProviderDataChange,
  hasFetchedModels,
  models,
  apiKey,
  transformer,
  availableTransformers
}: ApiKeyModelsSectionProps) {
  const { t } = useTranslation()
  const comboInputRef = useRef<HTMLInputElement>(null)

  const handleAddModel = (model: string) => {
    if (!providerData) return
    const updated = addProviderModel(providerData, model)
    if (updated) onProviderDataChange(updated)
  }

  const handleSetModelTransformers = (model: string, names: string[]) => {
    if (!providerData) return
    onProviderDataChange(setModelTransformerUse(providerData, model, names))
  }

  const handleSetModelDisabled = (model: string, disabled: boolean) => {
    if (!providerData) return
    onProviderDataChange(setModelDisabled(providerData, model, disabled))
  }

  return (
    <div className='space-y-2'>
      <Label htmlFor='models'>{t('providers.models')}</Label>
      <div className='space-y-2'>
        <div className='flex gap-2'>
          <div className='flex-1'>
            {hasFetchedModels ? (
              <ComboInput
                ref={comboInputRef}
                options={models.map((model) => ({ label: model, value: model }))}
                value=''
                onChange={() => {
                  // Only update the input value; do not add the model
                }}
                onEnter={(value) => handleAddModel(value)}
                inputPlaceholder={t('providers.models_placeholder')}
              />
            ) : (
              <Input
                id='models'
                placeholder={t('providers.models_placeholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    handleAddModel(e.currentTarget.value)
                    e.currentTarget.value = ''
                  }
                }}
              />
            )}
          </div>
          <Button
            onClick={() => {
              if (hasFetchedModels && comboInputRef.current) {
                const comboInput = comboInputRef.current as unknown as {
                  getCurrentValue(): string
                  clearInput(): void
                }
                const currentValue = comboInput.getCurrentValue()
                if (currentValue?.trim()) {
                  handleAddModel(currentValue.trim())
                  comboInput.clearInput()
                }
              } else {
                const input = document.getElementById('models') as HTMLInputElement
                if (input?.value.trim()) {
                  handleAddModel(input.value)
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
        <div className='divide-y border-y empty:border-none'>
          {[...models]
            .sort((a, b) => b.localeCompare(a))
            .map((model) => {
              const currentNames = ((transformer?.[model]?.use ?? []) as Array<unknown>).map((entry) =>
                typeof entry === 'string' ? entry : String((entry as Array<unknown>)[0])
              )
              const apiKeyMissing = (apiKey?.trim().length ?? 0) === 0
              const disabledList = Array.isArray((transformer as Record<string, unknown> | undefined)?._disabledModels)
                ? (transformer as Record<string, string[]>)._disabledModels
                : []
              const modelDisabled = disabledList.includes(model)
              return (
                <div key={model} className='flex items-center gap-3 px-3 py-2'>
                  <Switch
                    checked={!apiKeyMissing && !modelDisabled}
                    disabled={apiKeyMissing}
                    onCheckedChange={(checked) => handleSetModelDisabled(model, !checked)}
                  />
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
    </div>
  )
}
