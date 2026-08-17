import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui-ext/input'

interface ImportCredentialsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: 'claude' | 'codex'
  onProviderChange: (provider: 'claude' | 'codex') => void
  fileInputRef: RefObject<HTMLInputElement>
  onFileChange: (file: File | null) => void
  error: string | null
  loading: boolean
  disabled: boolean
  onSubmit: () => void
}

// Import credentials file — accepts ~/.claude/.credentials.json or ~/.codex/auth.json
export function ImportCredentialsDialog({
  open,
  onOpenChange,
  provider,
  onProviderChange,
  fileInputRef,
  onFileChange,
  error,
  loading,
  disabled,
  onSubmit
}: ImportCredentialsDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('providers.import_cred_title')}</DialogTitle>
          <DialogDescription>{t('providers.import_cred_description')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-4 py-2'>
          <div className='space-y-2'>
            <Label>{t('providers.import_cred_provider_label')}</Label>
            <div className='flex gap-2'>
              <Button
                size='sm'
                variant={provider === 'claude' ? 'default' : 'outline'}
                onClick={() => onProviderChange('claude')}
              >
                Claude
              </Button>
              <Button
                size='sm'
                variant={provider === 'codex' ? 'default' : 'outline'}
                onClick={() => onProviderChange('codex')}
              >
                Codex
              </Button>
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='cred-file'>
              {provider === 'claude'
                ? t('providers.import_cred_file_label_claude')
                : t('providers.import_cred_file_label_codex')}
            </Label>
            <Input
              id='cred-file'
              type='file'
              accept='.json,application/json'
              ref={fileInputRef}
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('app.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={loading || disabled}>
            {loading ? t('app.loading') : t('providers.import_cred_submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
