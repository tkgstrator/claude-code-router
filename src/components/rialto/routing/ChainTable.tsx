/**
 * The preference chain for one (surface profile, scenario, lane).
 *
 * Priority order is the entire point of the object, so the row leads with
 * the ordinal and a drag handle. Weight, quota and health are the
 * scheduler's live numbers for that target and each gets its own
 * right-aligned column — packing "0.60 / 71%" into one cell would make the
 * three unsortable and unscannable.
 */
import { useState } from 'react'
import { Meter, Pill } from '@/components/rialto/primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { RoutingSchedulerWeightEntry } from '@/lib/api'
import { fmtRate } from '@/lib/rialto/format'
import { cn } from '@/lib/utils'
import { inferTier, quotaUsedPct, STATE_TONE, splitTarget, targetState } from './derive'
import type { PreferenceEntry } from './types'

export interface ChainRowActions {
  onToggle: (index: number, enabled: boolean) => void
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
}

function RowMenu({ index, count, actions }: { index: number; count: number; actions: ChainRowActions }) {
  const [open, setOpen] = useState(false)
  const run = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }
  const item = 'w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60 disabled:opacity-40'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type='button' aria-label='Row actions' className='ml-1 text-muted-foreground/60 hover:text-foreground'>
          <i className='ri-more-2-fill text-sm' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-36 p-1'>
        <button
          type='button'
          className={item}
          disabled={index === 0}
          onClick={run(() => actions.onMove(index, index - 1))}
        >
          Move up
        </button>
        <button
          type='button'
          className={item}
          disabled={index === count - 1}
          onClick={run(() => actions.onMove(index, index + 1))}
        >
          Move down
        </button>
        <button type='button' className={cn(item, 'text-destructive')} onClick={run(() => actions.onRemove(index))}>
          Remove
        </button>
      </PopoverContent>
    </Popover>
  )
}

function QuotaCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>–</span>
  return (
    <div className='flex items-center gap-2'>
      <div className='w-16'>
        <Meter pct={pct} />
      </div>
      <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>{pct}%</span>
    </div>
  )
}

function ChainRow({
  entry,
  index,
  count,
  live,
  actions,
  onDragStart,
  onDragOver,
  onDrop
}: {
  entry: PreferenceEntry
  index: number
  count: number
  live: RoutingSchedulerWeightEntry | undefined
  actions: ChainRowActions
  onDragStart: () => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: () => void
}) {
  const state = targetState(live)
  const declared = entry.resolvedTier
  const tier = declared === null || declared === undefined ? inferTier(splitTarget(entry.target).model) : declared
  return (
    <tr
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn('border-t border-border/60 transition-colors hover:bg-muted/50', entry.enabled ? '' : 'opacity-45')}
    >
      <td className='py-2.5 pl-6 pr-2'>
        <div className='flex items-center gap-2'>
          <i className='ri-draggable text-base leading-none text-muted-foreground/50' />
          <span className='font-mono text-xs tabular-nums text-muted-foreground'>{index + 1}</span>
        </div>
      </td>
      <td className='px-2 font-mono text-xs'>{entry.target}</td>
      <td className='px-2'>{tier === null ? null : <Pill tone='mute'>{tier}</Pill>}</td>
      <td className='px-2'>
        <Pill tone={STATE_TONE[state]}>{state}</Pill>
      </td>
      <td className='px-2 text-right font-mono text-xs tabular-nums'>
        {live === undefined ? '–' : live.weight.toFixed(2)}
      </td>
      <td className='px-2'>
        <QuotaCell pct={quotaUsedPct(live)} />
      </td>
      <td className='px-2 text-right font-mono text-xs tabular-nums text-muted-foreground'>
        {live === undefined ? '–' : fmtRate(live.healthiness)}
      </td>
      <td className='py-2.5 pl-2 pr-6'>
        <div className='flex items-center justify-end gap-1'>
          <button
            type='button'
            role='switch'
            aria-checked={entry.enabled}
            aria-label={`Enable ${entry.target}`}
            onClick={() => actions.onToggle(index, !entry.enabled)}
            className={cn(
              'inline-flex h-4 w-7 items-center rounded-full px-0.5',
              entry.enabled ? 'bg-foreground' : 'bg-muted-foreground/30'
            )}
          >
            <span className={cn('size-3 rounded-full bg-background', entry.enabled ? 'translate-x-3' : '')} />
          </button>
          <RowMenu index={index} count={count} actions={actions} />
        </div>
      </td>
    </tr>
  )
}

export function ChainTable({
  entries,
  weights,
  actions
}: {
  entries: readonly PreferenceEntry[]
  weights: Map<string, RoutingSchedulerWeightEntry>
  actions: ChainRowActions
}) {
  // Index of the row currently being dragged. Held here rather than in the
  // row so a drop knows both ends of the move without a dataTransfer round
  // trip (which Safari only populates on drop).
  const [dragging, setDragging] = useState<number | null>(null)

  const drop = (to: number) => () => {
    if (dragging !== null && dragging !== to) actions.onMove(dragging, to)
    setDragging(null)
  }

  return (
    <table className='w-full table-fixed'>
      <colgroup>
        <col className='w-16' />
        <col />
        <col className='w-20' />
        <col className='w-24' />
        <col className='w-20' />
        <col className='w-32' />
        <col className='w-20' />
        <col className='w-24' />
      </colgroup>
      <thead>
        <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
          <th className='pb-2 pl-6 pr-2 text-left font-medium'>#</th>
          <th className='px-2 text-left font-medium'>Target</th>
          <th className='px-2 text-left font-medium'>Tier</th>
          <th className='px-2 text-left font-medium'>State</th>
          <th className='px-2 text-right font-medium'>Weight</th>
          <th className='px-2 text-left font-medium'>Quota</th>
          <th className='px-2 text-right font-medium'>Health</th>
          <th className='pb-2 pl-2 pr-6 text-right font-medium'>On</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <ChainRow
            key={entry.target}
            entry={entry}
            index={index}
            count={entries.length}
            live={weights.get(entry.target)}
            actions={actions}
            onDragStart={() => setDragging(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={drop(index)}
          />
        ))}
      </tbody>
    </table>
  )
}
