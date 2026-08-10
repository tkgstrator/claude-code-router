/**
 * Small "pencil → dialog → new name" widget shared by the Live editor
 * and the Preset editor. Kept as its own file so both call sites use
 * the same input UX (Enter to submit, blank string disabled, Cancel
 * closes without side effects).
 */

import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface Props {
  currentName: string
  // Persist the new name. Thrown errors are the caller's problem — we
  // just close the dialog and let onRename resolve; the parent surfaces
  // success/failure toasts.
  onRename: (name: string) => Promise<void> | void
  disabled?: boolean
}

export function RenameControl({ currentName, onRename, disabled }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(currentName)

  const openDialog = () => {
    setValue(currentName)
    setOpen(true)
  }

  const submit = async () => {
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed === currentName) {
      setOpen(false)
      return
    }
    await onRename(trimmed)
    setOpen(false)
  }

  return (
    <>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-7 w-7 p-0'
        aria-label={t('router.presetRename')}
        onClick={openDialog}
        disabled={disabled === true}
      >
        <Pencil className='h-3.5 w-3.5' />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('router.presetRename')}</DialogTitle>
          </DialogHeader>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('router.presetNamePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim().length > 0) void submit()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant='ghost' onClick={() => setOpen(false)}>
              {t('app.cancel')}
            </Button>
            <Button onClick={submit} disabled={value.trim().length === 0}>
              {t('app.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
