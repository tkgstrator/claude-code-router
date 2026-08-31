/**
 * Activity › Requests — one row per upstream call.
 *
 * Where Sessions groups calls, this is the raw log. The three columns that
 * did not exist in the old UI are `Requested → Sent`, `Rule` and `Lane`:
 * the routing decision was written to the request log all along but was
 * only readable by grepping pino output.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ActivityRequestLog, downloadCsv, fetchRequestLogs, percentile } from '@/components/rialto/activity/data'
import {
  ActivityTabs,
  DASH,
  type FilterOption,
  FilterSelect,
  NoteBox,
  ScreenMessage,
  StatTile,
  StatusPill,
  SurfaceCell
} from '@/components/rialto/activity/shared'
import { useActivityCounts } from '@/components/rialto/activity/use-activity-counts'
import { useSurfaces } from '@/components/rialto/activity/use-surfaces'
import { Pill, RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import dayjs from '@/lib/dayjs'
import { fmtCount, fmtLatency, fmtRate } from '@/lib/rialto/format'
import { fmtCost, fmtTokens } from '@/lib/sessions/format'
import { cn } from '@/lib/utils'

// The endpoint has no time filter, so the page is the newest N calls and
// every number on the screen describes that page.
const PAGE_SIZE = 200

// One refetch per burst: a busy stream fires an event per completed call.
const LIVE_REFRESH_MS = 2000

type RangeId = '1h' | '24h' | '7d' | 'all'

const RANGES: readonly { id: RangeId; label: string; hours: number }[] = [
  { id: '1h', label: 'Last hour', hours: 1 },
  { id: '24h', label: 'Last 24h', hours: 24 },
  { id: '7d', label: 'Last 7 days', hours: 168 },
  { id: 'all', label: 'All loaded', hours: 0 }
]

type StatusId = 'all' | 'ok' | 'rate-limited' | 'failed'

const STATUSES: readonly FilterOption<StatusId>[] = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: '2xx' },
  { id: 'rate-limited', label: '429' },
  { id: 'failed', label: '4xx / 5xx' }
]

interface Row {
  log: ActivityRequestLog
  surfacePath: string | null
  /** Nearest thing the data has to a caller identity — see the report. */
  client: string | null
  lane: string
  rule: string | null
}

type ColumnId =
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

interface ColumnDef {
  id: ColumnId
  label: string
  /** colgroup width class; empty means "take the remaining space". */
  width: string
  align: 'left' | 'right'
  cellClass: string
  render: (row: Row) => ReactNode
}

const lane = (isSubagent: boolean | null): string => {
  if (isSubagent === null) return 'untracked'
  return isSubagent ? 'subagent' : 'agent'
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

const COLUMNS: readonly ColumnDef[] = [
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

function RequestsTable({ rows, columns }: { rows: Row[]; columns: readonly ColumnDef[] }) {
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

interface Counts {
  total: number
  ok: number
  rateLimited: number
  failed: number
  p50: number | null
  p95: number | null
}

function summarise(rows: Row[]): Counts {
  const statuses = rows.map((r) => r.log.status)
  const durations = rows.filter((r) => r.log.durationMs > 0).map((r) => r.log.durationMs)
  durations.sort((a, b) => a - b)
  return {
    total: rows.length,
    ok: statuses.filter((s) => s >= 200 && s < 300).length,
    rateLimited: statuses.filter((s) => s === 429).length,
    failed: statuses.filter((s) => s >= 400 && s !== 429).length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95)
  }
}

function StatsRow({ counts, rangeLabel }: { counts: Counts; rangeLabel: string }) {
  const share = (n: number): string => (counts.total === 0 ? '–' : fmtRate(n / counts.total))
  return (
    <div className='grid grid-cols-5 gap-px border-b border-border px-6 py-4'>
      <StatTile size='base' label='Requests' value={counts.total.toLocaleString()} sub={rangeLabel.toLowerCase()} />
      <StatTile size='base' label='2xx' value={counts.ok.toLocaleString()} sub={share(counts.ok)} />
      <StatTile size='base' label='429' value={counts.rateLimited.toLocaleString()} sub='failed over' />
      <StatTile size='base' label='4xx / 5xx' value={counts.failed.toLocaleString()} sub={share(counts.failed)} />
      <StatTile
        size='base'
        label='p50 / p95'
        value={`${fmtLatency(counts.p50)} / ${fmtLatency(counts.p95)}`}
        sub='end to end'
      />
    </div>
  )
}

/** Header control that hides columns. Useful on a narrow window where the
 *  eleven-column log wraps into unreadability. */
function ColumnMenu({ hidden, onChange }: { hidden: Set<ColumnId>; onChange: (next: Set<ColumnId>) => void }) {
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

const statusMatches = (status: number, filter: StatusId): boolean => {
  if (filter === 'all') return true
  if (filter === 'ok') return status >= 200 && status < 300
  if (filter === 'rate-limited') return status === 429
  return status >= 400 && status !== 429
}

interface Filters {
  surface: string
  status: StatusId
  client: string
  rule: string
  range: RangeId
}

function applyFilters(rows: Row[], filters: Filters, now: number): Row[] {
  const spec = RANGES.find((r) => r.id === filters.range)
  const cutoff = spec === undefined || spec.hours === 0 ? null : now - spec.hours * 3_600_000
  return rows.filter((row) => {
    if (filters.surface !== 'all' && row.surfacePath !== filters.surface) return false
    if (!statusMatches(row.log.status, filters.status)) return false
    if (filters.client !== 'all' && row.client !== filters.client) return false
    if (filters.rule !== 'all' && row.rule !== filters.rule) return false
    return cutoff === null || Date.parse(row.log.createdAt) >= cutoff
  })
}

const options = (values: (string | null)[]): FilterOption<string>[] => [
  { id: 'all', label: 'All' },
  ...[...new Set(values.filter((v): v is string => v !== null))].sort().map((v) => ({ id: v, label: v }))
]

export function ActivityRequests() {
  const [page, setPage] = useState<{ items: ActivityRequestLog[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  // The mock ships this screen tailing: a request log that does not move
  // while requests are being served is the wrong default.
  const [live, setLive] = useState(true)
  const [hidden, setHidden] = useState<Set<ColumnId>>(new Set())
  const [filters, setFilters] = useState<Filters>({
    surface: 'all',
    status: 'all',
    client: 'all',
    rule: 'all',
    range: '24h'
  })
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const surfaces = useSurfaces()
  const tabCounts = useActivityCounts()

  const load = useCallback(() => {
    fetchRequestLogs(PAGE_SIZE)
      .then((res) => {
        setPage(res)
        setNow(Date.now())
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    if (!live) return
    const apiKey = localStorage.getItem('apiKey')
    if (apiKey === null || apiKey === '') return
    const es = new EventSource(`/api/request-logs/events?apikey=${encodeURIComponent(apiKey)}`)
    es.onmessage = () => {
      if (throttle.current !== null) return
      throttle.current = setTimeout(() => {
        throttle.current = null
        load()
      }, LIVE_REFRESH_MS)
    }
    // Left open on error: EventSource reconnects itself.
    return () => {
      es.close()
      if (throttle.current !== null) clearTimeout(throttle.current)
      throttle.current = null
    }
  }, [live, load])

  const rows = useMemo<Row[]>(() => {
    if (page === null) return []
    return page.items.map((log) => ({
      log,
      surfacePath: surfaces.pathOf(log.surface),
      client: surfaces.clientOf(log.surface),
      lane: lane(log.isSubagent),
      // No Rule entity exists yet; the scenario IS the routing decision
      // that matched, so it fills this column until rules are persisted.
      rule: log.scenario
    }))
  }, [page, surfaces.pathOf, surfaces.clientOf])

  const visible = useMemo(() => applyFilters(rows, filters, now), [rows, filters, now])
  const counts = useMemo(() => summarise(visible), [visible])
  const columns = useMemo(() => COLUMNS.filter((c) => !hidden.has(c.id)), [hidden])

  const rangeLabel = RANGES.find((r) => r.id === filters.range)
  const subtitle =
    page === null
      ? undefined
      : `${fmtCount(page.total)} requests logged · ${counts.rateLimited} failovers · newest ${page.items.length}`

  const exportCsv = () => {
    downloadCsv('rialto-requests.csv', [
      ['time', 'status', 'endpoint', 'requested', 'sent', 'rule', 'lane', 'input', 'output', 'ms', 'costUsd'],
      ...visible.map((r) => [
        r.log.createdAt,
        String(r.log.status),
        r.surfacePath === null ? '' : r.surfacePath,
        r.log.requestedModel === null ? '' : r.log.requestedModel,
        `${r.log.provider},${r.log.model}`,
        r.rule === null ? '' : r.rule,
        r.lane,
        String(r.log.totalInputTokens),
        String(r.log.outputTokens),
        String(r.log.durationMs),
        r.log.totalCostUsd === null ? '' : String(r.log.totalCostUsd)
      ])
    ])
  }

  return (
    <Screen
      title='Requests'
      subtitle={subtitle}
      actions={
        <>
          <RButton variant='outline' icon='ri-broadcast-line' aria-pressed={live} onClick={() => setLive((v) => !v)}>
            Live tail
          </RButton>
          <ColumnMenu hidden={hidden} onChange={setHidden} />
        </>
      }
    >
      <ActivityTabs
        active='requests'
        sessionCount={tabCounts.sessions}
        requestCount={page === null ? tabCounts.requests : page.total}
      />

      <div className='flex flex-wrap items-center gap-2 border-b border-border px-6 py-3'>
        <FilterSelect
          label='Surface'
          value={filters.surface}
          options={options(surfaces.surfaces.map((s) => s.path))}
          onChange={(surface) => setFilters((f) => ({ ...f, surface }))}
        />
        <FilterSelect
          label='Status'
          value={filters.status}
          options={STATUSES}
          onChange={(status) => setFilters((f) => ({ ...f, status }))}
        />
        <FilterSelect
          label='Token'
          value={filters.client}
          options={options(rows.map((r) => r.client))}
          onChange={(client) => setFilters((f) => ({ ...f, client }))}
        />
        <FilterSelect
          label='Rule'
          value={filters.rule}
          options={options(rows.map((r) => r.rule))}
          onChange={(rule) => setFilters((f) => ({ ...f, rule }))}
        />
        <FilterSelect
          label='Range'
          value={filters.range}
          options={RANGES.map((r) => ({ id: r.id, label: r.label }))}
          onChange={(range) => setFilters((f) => ({ ...f, range }))}
        />
        <div className='ml-auto flex items-center gap-2'>
          {live ? (
            <span className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
              <span className='size-1.5 animate-pulse rounded-full bg-emerald-500' /> live
            </span>
          ) : null}
          <RButton variant='ghost' icon='ri-download-line' onClick={exportCsv} disabled={visible.length === 0}>
            Export
          </RButton>
        </div>
      </div>

      <StatsRow counts={counts} rangeLabel={rangeLabel === undefined ? '' : rangeLabel.label} />

      {error !== null ? (
        <ScreenMessage tone='bad'>{error}</ScreenMessage>
      ) : page === null ? (
        <ScreenMessage>Loading…</ScreenMessage>
      ) : visible.length === 0 ? (
        <ScreenMessage>No requests match these filters.</ScreenMessage>
      ) : (
        <RequestsTable rows={visible} columns={columns} />
      )}

      <div className='px-6 py-4'>
        <NoteBox>
          A <span className='font-mono'>429</span> row is not an error the client saw — it is a failover step, paired
          with the retry that served the same turn. Subscription rows have no cost: the plan is already paid for.
        </NoteBox>
      </div>
      <div className='h-6' />
    </Screen>
  )
}
