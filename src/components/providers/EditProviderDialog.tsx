import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { SubscriptionView } from '@/lib/providers/subscription-view'
import type { Provider } from '@/types'
import { ApiKeyModelsSection } from './ApiKeyModelsSection'
import { ProviderCredentialsFields } from './ProviderCredentialsFields'
import { ProviderTransformerSection } from './ProviderTransformerSection'
import { SubscriptionAccountsPanel } from './SubscriptionAccountsPanel'
import { SubscriptionModelsSection } from './SubscriptionModelsSection'

interface EditProviderDialogProps {
  provider: Provider | null
  providerData: Provider | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  onProviderDataChange: (next: Provider) => void
  showApiKey: boolean
  onToggleShowApiKey: () => void
  apiKeyError: string | null
  subscriptionByProvider: Record<string, SubscriptionView>
  availableTransformers: { name: string; endpoint: string | null }[]
  paramInputs: Record<string, { name: string; value: string }>
  onParamInputsChange: Dispatch<SetStateAction<Record<string, { name: string; value: string }>>>
  hasFetchedModels: boolean
}

export function EditProviderDialog({
  provider,
  providerData,
  open,
  onOpenChange,
  onSave,
  onProviderDataChange,
  showApiKey,
  onToggleShowApiKey,
  apiKeyError,
  subscriptionByProvider,
  availableTransformers,
  paramInputs,
  onParamInputsChange,
  hasFetchedModels
}: EditProviderDialogProps) {
  const { t } = useTranslation()
  const isApiKeyMode = (provider?.auth_mode ?? 'api_key') === 'api_key'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[80vh] flex flex-col sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('providers.edit')}</DialogTitle>
          <DialogDescription>{t('providers.edit_description')}</DialogDescription>
        </DialogHeader>
        {provider && (
          <div className='space-y-4 p-4 overflow-y-auto flex-grow'>
            <div className='flex items-center justify-between border-b pb-3'>
              <div className='space-y-0.5'>
                <Label>{t('providers.provider_enabled')}</Label>
              </div>
              <Switch
                checked={provider.enabled !== false}
                onCheckedChange={(checked) => {
                  if (!providerData) return
                  onProviderDataChange({ ...providerData, enabled: checked })
                }}
              />
            </div>
            {isApiKeyMode ? (
              <ProviderCredentialsFields
                provider={provider}
                providerData={providerData}
                onProviderDataChange={onProviderDataChange}
                showApiKey={showApiKey}
                onToggleShowApiKey={onToggleShowApiKey}
                apiKeyError={apiKeyError}
              />
            ) : (
              <SubscriptionAccountsPanel
                provider={provider}
                providerData={providerData}
                onProviderDataChange={onProviderDataChange}
                subscriptionByProvider={subscriptionByProvider}
              />
            )}
            {isApiKeyMode ? (
              <div className='space-y-4'>
                <ProviderTransformerSection
                  providerData={providerData}
                  onProviderDataChange={onProviderDataChange}
                  transformerUse={provider.transformer?.use}
                  availableTransformers={availableTransformers}
                  paramInputs={paramInputs}
                  onParamInputsChange={onParamInputsChange}
                />
                <ApiKeyModelsSection
                  providerData={providerData}
                  onProviderDataChange={onProviderDataChange}
                  hasFetchedModels={hasFetchedModels}
                  models={provider.models || []}
                  apiKey={provider.api_key}
                  transformer={provider.transformer}
                  availableTransformers={availableTransformers}
                />
              </div>
            ) : (
              <SubscriptionModelsSection
                provider={provider}
                providerData={providerData}
                onProviderDataChange={onProviderDataChange}
                availableTransformers={availableTransformers}
              />
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
            <Button onClick={onSave}>{t('app.save')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
