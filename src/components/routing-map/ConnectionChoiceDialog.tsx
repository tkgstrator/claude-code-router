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
 * The FROM → TO summary at the top confirms which pair the choice
 * will wire together, so the user doesn't have to remember what
 * they dragged from and to across the dialog blocking the canvas.
 */

import { ArrowRight } from 'lucide-react'
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
  kindLabel,
  modelLabel,
  onChoose
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenarioLabel: string
  kindLabel: string
  modelLabel: string
  onChoose: (choice: ConnectionChoice) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:w-fit sm:max-w-[calc(100vw-4rem)]'>
        <DialogHeader>
          <DialogTitle>{t('routingMap.connect.title')}</DialogTitle>
          <DialogDescription>{t('routingMap.connect.description')}</DialogDescription>
        </DialogHeader>
        {/* FROM → TO summary so the choice below reads with a clear
            subject even though the dialog covers the canvas. */}
        <div className='flex items-center gap-3 rounded border bg-muted/40 px-3 py-2 text-xs'>
          <div className='min-w-0 flex-1 space-y-0.5'>
            <div className='text-[10px] uppercase tracking-wide text-muted-foreground'>
              {t('routingMap.connect.from')}
            </div>
            <div className='truncate font-medium'>
              {scenarioLabel} <span className='text-muted-foreground'>· {kindLabel}</span>
            </div>
          </div>
          <ArrowRight className='h-4 w-4 shrink-0 text-muted-foreground' aria-hidden='true' />
          <div className='min-w-0 flex-1 space-y-0.5'>
            <div className='text-[10px] uppercase tracking-wide text-muted-foreground'>
              {t('routingMap.connect.to')}
            </div>
            <div className='truncate font-mono font-medium'>{modelLabel}</div>
          </div>
        </div>
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
