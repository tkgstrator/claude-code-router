import { FileUp, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConnectChoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnect: (provider: 'claude' | 'codex') => void
  onImport: () => void
}

// Connect: choose which subscription provider to OAuth into
export function ConnectChoiceDialog({ open, onOpenChange, onConnect, onImport }: ConnectChoiceDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('providers.connect_choose_title')}</DialogTitle>
          <DialogDescription>{t('providers.connect_choose_description')}</DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-2 py-2'>
          <Button variant='outline' className='justify-start' onClick={() => onConnect('claude')}>
            <LogIn className='h-4 w-4' />
            {t('providers.connect_claude_option')}
          </Button>
          <Button variant='outline' className='justify-start' onClick={() => onConnect('codex')}>
            <LogIn className='h-4 w-4' />
            {t('providers.connect_codex_option')}
          </Button>
          <Button variant='outline' className='justify-start' onClick={onImport}>
            <FileUp className='h-4 w-4' />
            {t('providers.connect_import_option')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
