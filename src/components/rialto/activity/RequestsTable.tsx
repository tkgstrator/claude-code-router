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
import type { ReactNode } from 'react'
import type { Row } from '@/components/rialto/activity/requests-rows'
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
  label: string
  /** colgroup width class; empty means "take the remaining space". */
  width: string
  align: 'left' | 'right'
  cellClass: string
  render: (row: Row) => ReactNode
}

const tokens = (n: number): string => (n === 0 ? DASH : fmtTokens(n))

function ModelsCell({ row }: { row: Row }) {
  const requested = row.log.requestedModel
  return (
    <div className='flex items-center gap-1.5 font-mono text-[11px]'>
      <span className='truncate text-muted-foreground'>{requested === null ? 'untracked' : requested}</span>
      <i className='ri-arrow-right-line shrink-0 text-xs text-muted-foreground/50' />
      <span className='truncate'>{`${row.log.provider},${row.log.model}`}</span>
    </div>
  )
}

export const COLUMNS: readonly ColumnDef[] = [
  {
    id: 'time',
    label: 'Time',
    width: 'w-20',
    align: 'left',
    cellClass: 'font-mono text-[11px] tabular-nums text-muted-foreground',
    render: (row) => dayjs(row.log.createdAt).format('HH:mm:ss')
  },
  {
    id: 'status',
    label: 'Status',
    width: 'w-16',
    align: 'left',
    cellClass: '',
    render: (row) => <StatusPill status={row.log.status} />
  },
  {
    id: 'endpoint',
    label: 'Endpoint',
    width: 'w-40',
    align: 'left',
    cellClass: '',
    render: (row) => <SurfaceCell path={row.surfacePath} />
  },
  {
    id: 'models',
    label: 'Requested → Sent',
    width: '',
    align: 'left',
    cellClass: '',
    render: (row) => <ModelsCell row={row} />
  },
  {
    id: 'rule',
    label: 'Rule',
    width: 'w-32',
    align: 'left',
    cellClass: 'text-[11px]',
    render: (row) =>
      row.rule === null ? <span className='text-muted-foreground/50'>{DASH}</span> : <span>{row.rule}</span>
  },
  {
    id: 'lane',
    label: 'Lane',
    width: 'w-20',
    align: 'left',
    cellClass: '',
    render: (row) => <Pill tone='mute'>{row.lane}</Pill>
  },
  {
    id: 'token',
    label: 'Token',
    width: 'w-40',
    align: 'left',
    cellClass: 'truncate text-[11px] text-muted-foreground',
    render: (row) => (row.client === null ? 'untracked' : row.client)
  },
  {
    id: 'input',
    label: 'Input',
    width: 'w-20',
    align: 'right',
    cellClass: 'font-mono text-xs tabular-nums',
    render: (row) => tokens(row.log.totalInputTokens)
  },
  {
    id: 'output',
    label: 'Output',
    width: 'w-20',
    align: 'right',
    cellClass: 'font-mono text-xs tabular-nums',
    render: (row) => tokens(row.log.outputTokens)
  },
  {
    id: 'ms',
    label: 'ms',
    width: 'w-20',
    align: 'right',
    cellClass: 'font-mono text-xs tabular-nums text-muted-foreground',
    render: (row) => (row.log.durationMs === 0 ? DASH : row.log.durationMs.toLocaleString())
  },
  {
    id: 'cost',
    label: 'Cost',
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
  return (
    <tr className='border-t border-border/60 transition-colors hover:bg-muted/50'>
      {columns.map((col, i) => (
        <td
          key={col.id}
          className={cn(edgeClass(i, columns.length, true), col.align === 'right' ? 'text-right' : '', col.cellClass)}
        >
          {col.render(row)}
        </td>
      ))}
    </tr>
  )
}

export function RequestsTable({ rows, columns }: { rows: Row[]; columns: readonly ColumnDef[] }) {
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
              {col.label}
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
        Columns
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
              {col.label}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
