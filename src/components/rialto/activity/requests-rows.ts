/**
 * The Requests row model and everything that narrows it.
 *
 * Split from the screen because the filter bar and the table pull in
 * opposite directions: the table cares what a row looks like, the filter
 * bar only what a row *is*. Keeping the range/status vocabulary next to
 * `applyFilters` — rather than next to the controls that display it —
 * means a new range is one edit, and the screen never learns how a
 * cutoff is computed.
 */
import type { ActivityRequestLog } from '@/components/rialto/activity/data'
import type { FilterOption } from '@/components/rialto/activity/shared'

export type RangeId = '1h' | '24h' | '7d' | 'all'

export const RANGES: readonly { id: RangeId; label: string; hours: number }[] = [
  { id: '1h', label: 'Last hour', hours: 1 },
  { id: '24h', label: 'Last 24h', hours: 24 },
  { id: '7d', label: 'Last 7 days', hours: 168 },
  { id: 'all', label: 'All loaded', hours: 0 }
]

export type StatusId = 'all' | 'ok' | 'rate-limited' | 'failed'

export const STATUSES: readonly FilterOption<StatusId>[] = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: '2xx' },
  { id: 'rate-limited', label: '429' },
  { id: 'failed', label: '4xx / 5xx' }
]

export interface Row {
  log: ActivityRequestLog
  surfacePath: string | null
  /** Nearest thing the data has to a caller identity — see the report. */
  client: string | null
  lane: string
  rule: string | null
}

export const lane = (isSubagent: boolean | null): string => {
  if (isSubagent === null) return 'untracked'
  return isSubagent ? 'subagent' : 'agent'
}

const statusMatches = (status: number, filter: StatusId): boolean => {
  if (filter === 'all') return true
  if (filter === 'ok') return status >= 200 && status < 300
  if (filter === 'rate-limited') return status === 429
  return status >= 400 && status !== 429
}

export interface Filters {
  surface: string
  status: StatusId
  client: string
  rule: string
  range: RangeId
}

export function applyFilters(rows: Row[], filters: Filters, now: number): Row[] {
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

export const options = (values: (string | null)[]): FilterOption<string>[] => [
  { id: 'all', label: 'All' },
  ...[...new Set(values.filter((v): v is string => v !== null))].sort().map((v) => ({ id: v, label: v }))
]
