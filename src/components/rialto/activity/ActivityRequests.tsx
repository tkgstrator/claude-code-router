/**
 * Activity › Requests — one row per upstream call.
 *
 * Where Sessions groups calls, this is the raw log. The three columns that
 * did not exist in the old UI are `Requested → Sent`, `Rule` and `Lane`:
 * the routing decision was written to the request log all along but was
 * only readable by grepping pino output.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ActivityRequestLog, downloadCsv, fetchRequestLogs, percentile } from '@/components/rialto/activity/data'
import { COLUMNS, type ColumnId, ColumnMenu, RequestsTable } from '@/components/rialto/activity/RequestsTable'
import {
  applyFilters,
  type Filters,
  lane,
  options,
  RANGES,
  type Row,
  STATUSES
} from '@/components/rialto/activity/requests-rows'
import { ActivityTabs, FilterSelect, NoteBox, ScreenMessage, StatTile } from '@/components/rialto/activity/shared'
import { useActivityCounts } from '@/components/rialto/activity/use-activity-counts'
import { useSurfaces } from '@/components/rialto/activity/use-surfaces'
import { RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { fmtCount, fmtLatency, fmtRate } from '@/lib/rialto/format'

// The endpoint has no time filter, so the page is the newest N calls and
// every number on the screen describes that page.
const PAGE_SIZE = 200

// One refetch per burst: a busy stream fires an event per completed call.
const LIVE_REFRESH_MS = 2000

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
