/**
 * The Requests table: its column descriptors and the two components that
 * consume them.
 *
 * `ColumnMenu` lives here rather than with the screen's other header
 * controls because it is the one control whose entire content IS
 * `COLUMNS` — putting it on the far side of this boundary would mean
 * exporting the descriptor list purely so a popover could enumerate it.
 * A column added below shows up in the table and in the menu together.
 */
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LANE_KEYS, type Row } from '@/components/rialto/activity/requests-rows'
import { DASH, StatusPill, SurfaceCell } from '@/components/rialto/activity/shared'
import { Pill } from '@/components/rialto/primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import dayjs from '@/lib/dayjs'
import { fmtCost, fmtTokens } from '@/lib/sessions/format'
import { cn } from '@/lib/utils'

export type ColumnId =
  | 'time'
  | 'status'
  | 'endpoint'
  | 'models'
  | 'rule'
  | 'lane'
  | 'token'
  | 'input'
  | 'output'
  | 'ms'
  | 'cost'

export interface ColumnDef {
  id: ColumnId
  /** Translation key for the header; the table and the menu resolve it. */
  labelKey: string
  /** colgroup width class; empty means "take the remaining space". */
  width: string
  align: 'left' | 'right'
  cellClass: string
  /** `t` is threaded through because the descriptors are module-level. */
  render: (row: Row, t: TFunction) => ReactNode
}

const tokens = (n: number): string => (n === 0 ? DASH : fmtTokens(n))

function ModelsCell({ row }: { row: Row }) {
  const { t } = useTranslation()
  const requested = row.log.requestedModel
  return (
    <div className='flex items-center gap-1.5 font-mono text-[11px]'>
      <span className='truncate text-muted-foreground'>
        {requested === null ? t('activity.common.untracked') : requested}
      </span>
      <i className='ri-arrow-right-line shrink-0 text-xs text-muted-foreground/50' />
      <span className='truncate'>{`${row.log.provider},${row.log.model}`}</span>
    </div>
  )
}

export const COLUMNS: readonly ColumnDef[] = [
  {
    id: 'time',
    labelKey: 'activity.requests.colTime',
    width: 'w-20',
    align: 'left',
    cellClass: 'font-mono text-[11px] tabular-nums text-muted-foreground',
    render: (row) => dayjs(row.log.createdAt).format('HH:mm:ss')
  },
  {
    id: 'status',
    labelKey: 'activity.requests.colStatus',
    width: 'w-16',
    align: 'left',
    cellClass: '',
    render: (row) => <StatusPill status={row.log.status} />
  },
  {
    id: 'endpoint',
    labelKey: 'activity.requests.colEndpoint',
    width: 'w-40',
    align: 'left',
    cellClass: '',
    render: (row) => <SurfaceCell path={row.surfacePath} />
  },
  {
    id: 'models',
    labelKey: 'activity.requests.colModels',
    width: '',
    align: 'left',
    cellClass: '',
    render: (row) => <ModelsCell row={row} />
  },
  {
    id: 'rule',
    labelKey: 'activity.requests.colRule',
    width: 'w-32',
    align: 'left',
    cellClass: 'text-[11px]',
    render: (row) =>
      row.rule === null ? <span className='text-muted-foreground/50'>{DASH}</span> : <span>{row.rule}</span>
  },
  {
    id: 'lane',
    labelKey: 'activity.requests.colLane',
    width: 'w-20',
    align: 'left',
    cellClass: '',
    render: (row, t) => <Pill tone='mute'>{t(LANE_KEYS[row.lane])}</Pill>
  },
  {
    id: 'token',
    labelKey: 'activity.requests.colToken',
    width: 'w-40',
    align: 'left',
    cellClass: 'truncate text-[11px] text-muted-foreground',
    render: (row, t) => (row.client === null ? t('activity.common.untracked') : row.client)
  },
  {
    id: 'input',
    labelKey: 'activity.requests.colInput',
    width: 'w-20',
    align: 'right',
    cellClass: 'font-mono text-xs tabular-nums',
    render: (row) => tokens(row.log.totalInputTokens)
  },
  {
    id: 'output',
    labelKey: 'activity.requests.colOutput',
    width: 'w-20',
    align: 'right',
    cellClass: 'font-mono text-xs tabular-nums',
    render: (row) => tokens(row.log.outputTokens)
  },
  {
    id: 'ms',
    labelKey: 'activity.requests.colMs',
    width: 'w-20',
    align: 'right',
    cellClass: 'font-mono text-xs tabular-nums text-muted-foreground',
    render: (row) => (row.log.durationMs === 0 ? DASH : row.log.durationMs.toLocaleString())
  },
  {
    id: 'cost',
    labelKey: 'activity.requests.colCost',
    width: 'w-24',
    align: 'right',
    cellClass: 'font-mono text-xs tabular-nums',
    render: (row) => fmtCost(row.log.totalCostUsd)
  }
]

// First and last columns carry the table's outer gutter, so their padding
// is derived from position rather than baked into the descriptor — hiding
// a column has to move the gutter with it.
const edgeClass = (index: number, count: number, cell: boolean): string => {
  const pad = cell ? 'py-2.5' : 'pb-2'
  if (index === 0) return `${pad} pl-6 pr-2`
  if (index === count - 1) return `${pad} pl-2 pr-6`
  return cell ? 'px-2' : 'px-2'
}

function RequestRow({ row, columns }: { row: Row; columns: readonly ColumnDef[] }) {
  const { t } = useTranslation()
  return (
    <tr className='border-t border-border/60 transition-colors hover:bg-muted/50'>
      {columns.map((col, i) => (
        <td
          key={col.id}
          className={cn(edgeClass(i, columns.length, true), col.align === 'right' ? 'text-right' : '', col.cellClass)}
        >
          {col.render(row, t)}
        </td>
      ))}
    </tr>
  )
}

export function RequestsTable({ rows, columns }: { rows: Row[]; columns: readonly ColumnDef[] }) {
  const { t } = useTranslation()
  return (
    <table className='w-full table-fixed'>
      <colgroup>
        {columns.map((col) => (
          <col key={col.id} className={col.width} />
        ))}
      </colgroup>
      <thead>
        <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
          {columns.map((col, i) => (
            <th
              key={col.id}
              className={cn(
                edgeClass(i, columns.length, false),
                col.align === 'right' ? 'text-right' : 'text-left',
                'font-medium'
              )}
            >
              {t(col.labelKey)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <RequestRow key={row.log.id} row={row} columns={columns} />
        ))}
      </tbody>
    </table>
  )
}

/** Header control that hides columns. Useful on a narrow window where the
 *  eleven-column log wraps into unreadability. */
export function ColumnMenu({ hidden, onChange }: { hidden: Set<ColumnId>; onChange: (next: Set<ColumnId>) => void }) {
  const { t } = useTranslation()
  const toggle = (id: ColumnId) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  return (
    <Popover>
      <PopoverTrigger className='inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'>
        <i className='ri-layout-column-line text-sm leading-none' />
        {t('activity.requests.columnsMenu')}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-48 gap-0 p-1'>
        {COLUMNS.map((col) => {
          const on = !hidden.has(col.id)
          return (
            <button
              key={col.id}
              type='button'
              onClick={() => toggle(col.id)}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60',
                on ? 'font-medium' : 'text-muted-foreground'
              )}
            >
              <i className={cn('ri-check-line text-xs', on ? '' : 'opacity-0')} />
              {t(col.labelKey)}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
