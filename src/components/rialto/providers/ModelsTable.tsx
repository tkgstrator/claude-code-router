/**
 * The model table on a provider detail.
 *
 * Prices stay in three separate right-aligned columns (in / cached / out).
 * One packed "$3/$0.30/$15" cell is unreadable and unsortable, and the
 * three legs are independently null — a vendor that publishes no cached
 * price still publishes the other two.
 */
import { Pill } from '@/components/rialto/primitives'
import { fmtCost } from '@/lib/sessions/format'
import { cn } from '@/lib/utils'
import { fmtContext, type ModelRow } from './derive'
import type { TestStatus } from './types'

const TEST_ICON: Record<TestStatus, string> = {
  ok: 'ri-check-line text-emerald-600 dark:text-emerald-400',
  fail: 'ri-close-line text-destructive',
  unknown: 'ri-subtract-line text-muted-foreground/50'
}

function TestIcon({ status }: { status: TestStatus }) {
  return <i className={TEST_ICON[status]} />
}

/**
 * The 16×28 switch. A real button rather than the mock's static span, so
 * the row is operable from the keyboard without a second affordance.
 */
function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type='button' onClick={onClick} aria-pressed={on} aria-label={label} className='align-middle'>
      <span
        className={cn(
          'inline-flex h-4 w-7 items-center rounded-full px-0.5 align-middle',
          on ? 'bg-foreground' : 'bg-muted-foreground/30'
        )}
      >
        <span className={cn('size-3 rounded-full bg-background', on ? 'translate-x-3' : '')} />
      </span>
    </button>
  )
}

const NUM_CELL = 'px-2 text-right font-mono text-xs tabular-nums'
const HEAD_CELL = 'px-2 text-right font-medium'

function Head({ withOverride }: { withOverride: boolean }) {
  return (
    <thead>
      <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
        <th className='pb-2 pl-6 pr-2 text-left font-medium'>Model</th>
        <th className='px-2 text-left font-medium'>Tier</th>
        <th className={HEAD_CELL}>Context</th>
        <th className={HEAD_CELL}>In /1M</th>
        <th className={HEAD_CELL}>Cached</th>
        <th className={HEAD_CELL}>Out /1M</th>
        {withOverride ? <th className='px-2 text-left font-medium'>Override</th> : null}
        <th className='px-2 text-center font-medium'>Test</th>
        <th className='pb-2 pl-2 pr-6 text-right font-medium'>On</th>
      </tr>
    </thead>
  )
}

function Row({
  row,
  withOverride,
  onToggle
}: {
  row: ModelRow
  withOverride: boolean
  onToggle: (model: string, next: boolean) => void
}) {
  // Subscription models carry no per-token price, so their money columns
  // read as absent rather than as a number worth comparing.
  const priceTone = withOverride ? '' : 'text-muted-foreground'
  return (
    <tr
      className={cn('border-t border-border/60 transition-colors hover:bg-muted/50', row.enabled ? '' : 'opacity-45')}
    >
      <td className='py-2.5 pl-6 pr-2'>
        <div className='flex items-center gap-2'>
          <span className='font-mono text-xs'>{row.name}</span>
          {row.legacy ? <Pill tone='mute'>legacy</Pill> : null}
        </div>
      </td>
      <td className='px-2'>{row.tier === null ? null : <Pill tone='mute'>{row.tier}</Pill>}</td>
      <td className={cn(NUM_CELL, 'text-muted-foreground')}>{fmtContext(row.contextWindow)}</td>
      <td className={cn(NUM_CELL, priceTone)}>{fmtCost(row.inputPer1M)}</td>
      <td className={cn(NUM_CELL, 'text-muted-foreground')}>{fmtCost(row.cachedInputPer1M)}</td>
      <td className={cn(NUM_CELL, priceTone)}>{fmtCost(row.outputPer1M)}</td>
      {withOverride ? (
        <td className='px-2 font-mono text-[11px] text-muted-foreground'>
          {row.apiStyleOverride === null ? '—' : row.apiStyleOverride}
        </td>
      ) : null}
      <td className='px-2 text-center text-sm leading-none'>
        <TestIcon status={row.test} />
      </td>
      <td className='py-2.5 pl-2 pr-6 text-right'>
        <Toggle on={row.enabled} label={row.name} onClick={() => onToggle(row.name, !row.enabled)} />
      </td>
    </tr>
  )
}

export function ModelsTable({
  rows,
  withOverride,
  onToggle
}: {
  rows: ModelRow[]
  withOverride: boolean
  onToggle: (model: string, next: boolean) => void
}) {
  if (rows.length === 0) {
    return <div className='px-6 pb-6 text-xs text-muted-foreground'>No models on this provider yet.</div>
  }
  return (
    <table className='w-full table-fixed'>
      <colgroup>
        <col />
        <col className='w-20' />
        <col className='w-20' />
        <col className='w-20' />
        <col className='w-20' />
        <col className='w-20' />
        {withOverride ? <col className='w-24' /> : null}
        <col className={withOverride ? 'w-14' : 'w-16'} />
        <col className={withOverride ? 'w-16' : 'w-20'} />
      </colgroup>
      <Head withOverride={withOverride} />
      <tbody>
        {rows.map((row) => (
          <Row key={row.name} row={row} withOverride={withOverride} onToggle={onToggle} />
        ))}
      </tbody>
    </table>
  )
}
