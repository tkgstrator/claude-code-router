import { Link, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface InstallPresetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  installUrl: string
  onInstallUrlChange: (value: string) => void
  installName: string
  onInstallNameChange: (value: string) => void
  onSelectUrlMethod: () => void
  onInstall: () => void
  isInstalling: boolean
}

export function InstallPresetDialog({
  open,
  onOpenChange,
  installUrl,
  onInstallUrlChange,
  installName,
  onInstallNameChange,
  onSelectUrlMethod,
  onInstall,
  isInstalling
}: InstallPresetDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('presets.install_dialog_title')}</DialogTitle>
          <DialogDescription>{t('presets.install_dialog_description')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-4 py-4'>
          <div className='flex gap-2'>
            <Button variant='default' onClick={onSelectUrlMethod} className='flex-1'>
              <Link className='mr-2 h-4 w-4' />
              {t('presets.from_url')}
            </Button>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='preset-url'>{t('presets.github_repository')}</Label>
            <Input
              id='preset-url'
              type='url'
              placeholder={t('presets.preset_url_placeholder')}
              value={installUrl}
              onChange={(e) => onInstallUrlChange(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>{t('presets.github_url_hint')}</p>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='preset-name'>{t('presets.preset_name')}</Label>
            <Input
              id='preset-name'
              placeholder={t('presets.preset_name_placeholder')}
              value={installName}
              onChange={(e) => onInstallNameChange(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('presets.close')}
          </Button>
          <Button onClick={onInstall} disabled={isInstalling}>
            {isInstalling ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                {t('presets.installing')}
              </>
            ) : (
              t('presets.install')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
