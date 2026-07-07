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

interface DeletePresetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetName: string | null
  onConfirm: () => void
}

export function DeletePresetDialog({ open, onOpenChange, presetName, onConfirm }: DeletePresetDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('presets.delete_dialog_title')}</DialogTitle>
          <DialogDescription>{t('presets.delete_dialog_description', { name: presetName })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('presets.close')}
          </Button>
          <Button variant='destructive' onClick={onConfirm}>
            {t('presets.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
