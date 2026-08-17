import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui-ext/input'
import { Label } from '@/components/ui/label'
import { applyProviderFieldChange } from '@/lib/providers/provider-edits'
import type { Provider } from '@/types'

interface ProviderCredentialsFieldsProps {
  provider: Provider
  providerData: Provider | null
  onProviderDataChange: (next: Provider) => void
  showApiKey: boolean
  onToggleShowApiKey: () => void
  apiKeyError: string | null
}

// api_key auth mode: base URL + secret key, with a show/hide toggle.
export function ProviderCredentialsFields({
  provider,
  providerData,
  onProviderDataChange,
  showApiKey,
  onToggleShowApiKey,
  apiKeyError
}: ProviderCredentialsFieldsProps) {
  const { t } = useTranslation()

  const handleFieldChange = (field: string, value: string) => {
    if (!providerData) return
    onProviderDataChange(applyProviderFieldChange(providerData, field, value))
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='api_base_url'>{t('providers.api_base_url')}</Label>
        <Input
          id='api_base_url'
          value={provider.api_base_url || ''}
          onChange={(e) => handleFieldChange('api_base_url', e.target.value)}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='api_key'>{t('providers.api_key')}</Label>
        <div className='relative'>
          <Input
            id='api_key'
            type={showApiKey ? 'text' : 'password'}
            value={provider.api_key || ''}
            onChange={(e) => handleFieldChange('api_key', e.target.value)}
            className={apiKeyError ? 'border-red-500' : ''}
          />
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='absolute right-2 top-1/2 transform -translate-y-1/2 h-8 w-8'
            onClick={onToggleShowApiKey}
          >
            {showApiKey ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
          </Button>
        </div>
        {apiKeyError && <p className='text-sm text-red-500'>{apiKeyError}</p>}
      </div>
    </div>
  )
}
