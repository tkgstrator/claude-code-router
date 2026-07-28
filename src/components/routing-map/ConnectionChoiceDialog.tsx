/**
 * Dialog shown when the user drags a second (or later) edge from a
 * scenario handle onto a model on the canvas. The first drag is
 * treated as "become the primary" (handled without a dialog), but
 * once a primary exists the drag can mean either:
 *
 *   - append to the catch-all fallback chain (a runtime failover
 *     target — tried when the primary is rate-limited), or
 *   - create a new predicated rule that routes to the dragged model
 *     under a condition the user then edits in the side panel.
 *
 * Rather than guessing, the drag pauses and this dialog surfaces
 * both choices explicitly. The chosen mutation is applied by the
 * caller so this component stays purely presentational.
 */

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

export type ConnectionChoice = 'fallback' | 'rule'

export function ConnectionChoiceDialog({
  open,
  onOpenChange,
  scenarioLabel,
  modelLabel,
  onChoose
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenarioLabel: string
  modelLabel: string
  onChoose: (choice: ConnectionChoice) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:w-fit sm:max-w-[calc(100vw-4rem)]'>
        <DialogHeader>
          <DialogTitle>{t('routingMap.connect.title')}</DialogTitle>
          <DialogDescription>
            {t('routingMap.connect.description', { scenario: scenarioLabel, model: modelLabel })}
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-2'>
          <Button
            type='button'
            variant='outline'
            className='justify-start text-left h-auto py-3'
            onClick={() => onChoose('fallback')}
          >
            <div className='space-y-0.5'>
              <div className='text-sm font-medium'>{t('routingMap.connect.asFallback')}</div>
              <div className='text-xs text-muted-foreground'>{t('routingMap.connect.asFallbackHelp')}</div>
            </div>
          </Button>
          <Button
            type='button'
            variant='outline'
            className='justify-start text-left h-auto py-3'
            onClick={() => onChoose('rule')}
          >
            <div className='space-y-0.5'>
              <div className='text-sm font-medium'>{t('routingMap.connect.asRule')}</div>
              <div className='text-xs text-muted-foreground'>{t('routingMap.connect.asRuleHelp')}</div>
            </div>
          </Button>
        </div>
        <DialogFooter>
          <Button type='button' variant='ghost' onClick={() => onOpenChange(false)}>
            {t('app.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
