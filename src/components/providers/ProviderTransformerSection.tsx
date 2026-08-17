import { Plus, Trash2, X } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectCombobox as Combobox } from '@/components/SelectCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui-ext/input'
import { Label } from '@/components/ui/label'
import {
  addProviderTransformerParam,
  addProviderTransformerUse,
  removeProviderTransformerParamAt,
  removeProviderTransformerUseAt
} from '@/lib/providers/provider-edits'
import type { Provider, ProviderTransformer } from '@/types'

interface ProviderTransformerSectionProps {
  providerData: Provider | null
  onProviderDataChange: (next: Provider) => void
  transformerUse: ProviderTransformer['use']
  availableTransformers: { name: string; endpoint: string | null }[]
  paramInputs: Record<string, { name: string; value: string }>
  onParamInputsChange: Dispatch<SetStateAction<Record<string, { name: string; value: string }>>>
}

// Provider-level transformer picker plus a per-transformer key/value
// parameter editor (e.g. maxtoken's `max_tokens`).
export function ProviderTransformerSection({
  providerData,
  onProviderDataChange,
  transformerUse,
  availableTransformers,
  paramInputs,
  onParamInputsChange
}: ProviderTransformerSectionProps) {
  const { t } = useTranslation()

  const handleAddTransformer = (transformerPath: string) => {
    if (!transformerPath || !providerData) return
    onProviderDataChange(addProviderTransformerUse(providerData, transformerPath))
  }

  const handleRemoveTransformerAt = (transformerIndex: number) => {
    if (!providerData) return
    onProviderDataChange(removeProviderTransformerUseAt(providerData, transformerIndex))
  }

  const handleAddParam = (transformerIndex: number, paramName: string, paramValue: string) => {
    if (!providerData) return
    onProviderDataChange(addProviderTransformerParam(providerData, transformerIndex, paramName, paramValue))
  }

  const handleRemoveParam = (transformerIndex: number, paramName: string) => {
    if (!providerData) return
    const updated = removeProviderTransformerParamAt(providerData, transformerIndex, paramName)
    if (updated) onProviderDataChange(updated)
  }

  return (
    <div className='space-y-2'>
      <Label>{t('providers.provider_transformer')}</Label>

      {/* Add new transformer */}
      <div className='flex gap-2'>
        <Combobox
          options={availableTransformers.map((tr) => ({
            label: tr.name,
            value: tr.name
          }))}
          value=''
          onChange={handleAddTransformer}
          placeholder={t('providers.select_transformer')}
          emptyPlaceholder={t('providers.no_transformers')}
        />
      </div>

      {/* Display existing transformers */}
      {transformerUse && transformerUse.length > 0 && (
        <div className='space-y-2 mt-2'>
          <div className='text-sm font-medium text-foreground'>{t('providers.selected_transformers')}</div>
          {transformerUse.map(
            (
              transformer: string | (string | Record<string, unknown> | { max_tokens: number })[],
              transformerIndex: number
            ) => (
              <div key={transformerIndex} className='border-b pb-3 last:border-b-0 last:pb-0'>
                <div className='flex gap-2 items-center mb-2'>
                  <div className='flex-1 bg-muted rounded p-2 text-sm'>
                    {typeof transformer === 'string'
                      ? transformer
                      : Array.isArray(transformer)
                        ? String(transformer[0])
                        : String(transformer)}
                  </div>
                  <Button variant='outline' size='icon' onClick={() => handleRemoveTransformerAt(transformerIndex)}>
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>

                {/* Transformer-specific Parameters */}
                <div className='mt-2 pl-4 border-l-2 border-border'>
                  <Label className='text-sm'>{t('providers.transformer_parameters')}</Label>
                  <div className='space-y-2 mt-1'>
                    <div className='flex gap-2'>
                      <Input
                        placeholder={t('providers.parameter_name')}
                        value={paramInputs[`transformer-${transformerIndex}`]?.name || ''}
                        onChange={(e) => {
                          const key = `transformer-${transformerIndex}`
                          onParamInputsChange((prev) => ({
                            ...prev,
                            [key]: { ...(prev[key] || { name: '', value: '' }), name: e.target.value }
                          }))
                        }}
                      />
                      <Input
                        placeholder={t('providers.parameter_value')}
                        value={paramInputs[`transformer-${transformerIndex}`]?.value || ''}
                        onChange={(e) => {
                          const key = `transformer-${transformerIndex}`
                          onParamInputsChange((prev) => ({
                            ...prev,
                            [key]: { ...(prev[key] || { name: '', value: '' }), value: e.target.value }
                          }))
                        }}
                      />
                      <Button
                        size='sm'
                        onClick={() => {
                          const key = `transformer-${transformerIndex}`
                          const paramInput = paramInputs[key]
                          if (paramInput && paramInput.name && paramInput.value) {
                            handleAddParam(transformerIndex, paramInput.name, paramInput.value)
                            onParamInputsChange((prev) => ({ ...prev, [key]: { name: '', value: '' } }))
                          }
                        }}
                      >
                        <Plus className='h-4 w-4' />
                      </Button>
                    </div>

                    {/* Display existing parameters for this transformer */}
                    {(() => {
                      if (!transformerUse || transformerUse.length <= transformerIndex) {
                        return null
                      }
                      const targetTransformer = transformerUse[transformerIndex]
                      const params =
                        Array.isArray(targetTransformer) &&
                        targetTransformer.length > 1 &&
                        typeof targetTransformer[1] === 'object' &&
                        targetTransformer[1] !== null
                          ? (targetTransformer[1] as Record<string, unknown>)
                          : {}
                      return Object.keys(params).length > 0 ? (
                        <div className='space-y-1'>
                          {Object.entries(params).map(([key, value]) => (
                            <div key={key} className='flex items-center justify-between bg-muted rounded p-2'>
                              <div className='text-sm'>
                                <span className='font-medium'>{key}:</span> {String(value)}
                              </div>
                              <Button
                                variant='ghost'
                                size='sm'
                                className='h-6 w-6 p-0'
                                onClick={() => handleRemoveParam(transformerIndex, key)}
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
  )
}
