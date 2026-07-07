import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ManualCallbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  onUrlChange: (url: string) => void
  error: string | null
  loading: boolean
  onSubmit: () => void
}

// Manual callback relay — for remote deployments where localhost is unreachable
export function ManualCallbackDialog({
  open,
  onOpenChange,
  url,
  onUrlChange,
  error,
  loading,
  onSubmit
}: ManualCallbackDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('providers.manual_callback_title')}</DialogTitle>
          <DialogDescription>{t('providers.manual_callback_description')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-3 py-2'>
          <Label htmlFor='callback-url'>{t('providers.manual_callback_label')}</Label>
          <Input
            id='callback-url'
            placeholder='yA88Lgr...#pj8oVX_...'
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
          />
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('app.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={loading || !url.trim()}>
            {loading ? t('app.loading') : t('providers.manual_callback_submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
