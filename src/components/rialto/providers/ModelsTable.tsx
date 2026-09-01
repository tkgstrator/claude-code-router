/**
 * The model table on a provider detail.
 *
 * Prices stay in three separate right-aligned columns (in / cached / out).
 * One packed "$3/$0.30/$15" cell is unreadable and unsortable, and the
 * three legs are independently null — a vendor that publishes no cached
 * price still publishes the other two.
 */
import { useTranslation } from 'react-i18next'
import { Pill } from '@/components/rialto/primitives'
import { SortTh, type SortValue, useTableSort } from '@/components/rialto/table-sort'
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

type ModelSortKey =
  | 'name'
  | 'tier'
  | 'contextWindow'
  | 'inputPer1M'
  | 'cachedInputPer1M'
  | 'outputPer1M'
  | 'test'
  | 'enabled'

// Sorting reads the row's own field for every column, so what the header
// orders by is what the cell shows. `tier` and `test` are short enums
// rendered as a pill / glyph; sorting them alphabetically groups like
// with like, which is the whole point of clicking those two.
const modelSortValue = (row: ModelRow, key: ModelSortKey): SortValue => row[key]

const NUM_CELL = 'px-2 text-right font-mono text-xs tabular-nums'
const HEAD_CELL = 'px-2 text-right font-medium'

function Head({
  withOverride,
  sort
}: {
  withOverride: boolean
  sort: ReturnType<typeof useTableSort<ModelRow, ModelSortKey>>
}) {
  const { t } = useTranslation()
  return (
    <thead>
      <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70 [&>th]:pb-2'>
        <SortTh sortKey='name' sort={sort} className='pl-6 pr-2 text-left'>
          {t('providers.models.colModel')}
        </SortTh>
        <SortTh sortKey='tier' sort={sort} className='px-2 text-left'>
          {t('providers.models.colTier')}
        </SortTh>
        <SortTh sortKey='contextWindow' sort={sort} className={HEAD_CELL} align='right'>
          {t('providers.models.colContext')}
        </SortTh>
        <SortTh sortKey='inputPer1M' sort={sort} className={HEAD_CELL} align='right'>
          {t('providers.models.colIn')}
        </SortTh>
        <SortTh sortKey='cachedInputPer1M' sort={sort} className={HEAD_CELL} align='right'>
          {t('providers.models.colCached')}
        </SortTh>
        <SortTh sortKey='outputPer1M' sort={sort} className={HEAD_CELL} align='right'>
          {t('providers.models.colOut')}
        </SortTh>
        {/* The api-style override is a picker, not a value the operator
            scans down a column, so it stays unsorted. */}
        {withOverride ? <th className='px-2 text-left font-medium'>{t('providers.models.colOverride')}</th> : null}
        <SortTh sortKey='test' sort={sort} className='px-2 text-center' align='center'>
          {t('providers.models.colTest')}
        </SortTh>
        <SortTh sortKey='enabled' sort={sort} className='pl-2 pr-6 text-right' align='right'>
          {t('providers.models.colOn')}
        </SortTh>
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
  const { t } = useTranslation()
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
          {row.legacy ? <Pill tone='mute'>{t('providers.models.legacy')}</Pill> : null}
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
        <Toggle
          on={row.enabled}
          label={t('providers.models.toggleModel', { model: row.name })}
          onClick={() => onToggle(row.name, !row.enabled)}
        />
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
  const { t } = useTranslation()
  // Hooks run before the empty-state return: an early return above a hook
  // changes the hook order between renders.
  const sort = useTableSort<ModelRow, ModelSortKey>(rows, modelSortValue)
  if (rows.length === 0) {
    return <div className='px-6 pb-6 text-xs text-muted-foreground'>{t('providers.models.empty')}</div>
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
      <Head withOverride={withOverride} sort={sort} />
      <tbody>
        {sort.sorted.map((row) => (
          <Row key={row.name} row={row} withOverride={withOverride} onToggle={onToggle} />
        ))}
      </tbody>
    </table>
  )
}
