/**
 * Target picker for the chain.
 *
 * Lists the enabled `provider,model` targets that are not already in the
 * chain being edited, so adding one can never create the duplicate the
 * server would drop with a warning.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pill, RButton } from '@/components/rialto/primitives'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { EnabledTarget } from './types'

export function AddTargetDialog({
  targets,
  taken,
  onAdd
}: {
  targets: readonly EnabledTarget[]
  taken: ReadonlySet<string>
  onAdd: (target: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const options = useMemo(() => targets.filter((t) => !taken.has(t.target)), [targets, taken])

  return (
    <>
      <RButton variant='outline' icon='ri-add-line' onClick={() => setOpen(true)}>
        {t('routing.chain.addTarget')}
      </RButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='p-0 sm:max-w-lg'>
          <DialogHeader className='px-4 pt-4'>
            <DialogTitle className='text-sm'>{t('routing.chain.addTarget')}</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder={t('routing.chain.searchTargets')} />
            <CommandList>
              <CommandEmpty>{t('routing.chain.noTargetsLeft')}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.target}
                    value={option.target}
                    className='text-xs'
                    onSelect={() => {
                      onAdd(option.target)
                      setOpen(false)
                    }}
                  >
                    <span className='truncate font-mono'>{option.target}</span>
                    {option.tier === null ? null : (
                      <Pill tone='mute' className='ml-auto'>
                        {option.tier}
                      </Pill>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
