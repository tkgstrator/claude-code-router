/**
 * Activity › Sessions — one row per conversation.
 *
 * Absorbs the old Sessions grid, Usage and ApiCost: they answered the same
 * question ("where did the traffic and the money go") at three zoom levels
 * and forced the operator to hold three screens in their head at once.
 *
 * The headline tiles come from the server-side /api/usage/cost aggregate,
 * not from the loaded page, so they describe the whole window even though
 * the table is paginated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  type ActivityRequestLog,
  callTimesBySession,
  downloadCsv,
  fetchRequestLogs,
  fetchUsageCost,
  summariseUsageCost,
  trendBuckets,
  type WindowTotals
} from '@/components/rialto/activity/data'
import {
  ActivityTabs,
  type FilterOption,
  FilterSelect,
  ScreenMessage,
  Sparkline,
  StatTile,
  SurfaceCell
} from '@/components/rialto/activity/shared'
import { useSurfaces } from '@/components/rialto/activity/use-surfaces'
import { RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { api, type SessionSummary } from '@/lib/api'
import { fmtAgo, fmtCount, fmtRate } from '@/lib/rialto/format'
import { fmtCost, fmtTokens } from '@/lib/sessions/format'

type RangeId = '24h' | '7d' | '30d' | 'all'

interface RangeSpec {
  id: RangeId
  label: string
  /** For /api/request-logs/sessions, which counts back in hours. 0 = no limit. */
  hours: number
  /** For /api/usage/cost, which counts back in days. 0 = no limit. */
  days: number
}

const RANGES: readonly RangeSpec[] = [
  { id: '24h', label: 'Last 24 hours', hours: 24, days: 1 },
  { id: '7d', label: 'Last 7 days', hours: 168, days: 7 },
  { id: '30d', label: 'Last 30 days', hours: 720, days: 30 },
  { id: 'all', label: 'All time', hours: 0, days: 0 }
]

const rangeSpec = (id: RangeId): RangeSpec => {
  const found = RANGES.find((r) => r.id === id)
  return found === undefined ? RANGES[1] : found
}

const ALL = 'all'

// Newest calls joined onto the session rows for the trend column alone.
// The session aggregate carries no time series; everything else on the
// row, `surface` included, comes from the aggregate itself.
const JOIN_LOG_LIMIT = 500

const SESSION_PAGE = 100

interface Enriched {
  session: SessionSummary
  surfacePath: string | null
  trend: number[] | null
  model: string | null
}

function enrich(
  sessions: SessionSummary[],
  logs: ActivityRequestLog[],
  pathOf: (id: string | null) => string | null
): Enriched[] {
  const byTimes = callTimesBySession(logs)
  return sessions.map((session) => {
    const times = byTimes.get(session.sessionId)
    return {
      session,
      surfacePath: pathOf(session.surface),
      trend: times === undefined ? null : trendBuckets(times, Date.parse(session.firstAt), Date.parse(session.lastAt)),
      model: session.models.length === 0 ? null : session.models[0]
    }
  })
}

function matchesQuery(row: Enriched, query: string): boolean {
  if (query === '') return true
  const preview = row.session.preview
  const haystack = preview === null ? row.session.sessionId : `${row.session.sessionId} ${preview}`
  return haystack.toLowerCase().includes(query.toLowerCase())
}

function applyFilters(
  rows: Enriched[],
  filters: { surface: string; provider: string; model: string; query: string }
): Enriched[] {
  return rows.filter((row) => {
    if (filters.surface !== ALL && row.surfacePath !== filters.surface) return false
    if (filters.provider !== ALL && !row.session.providers.includes(filters.provider)) return false
    if (filters.model !== ALL && !row.session.models.includes(filters.model)) return false
    return matchesQuery(row, filters.query)
  })
}

function options(values: string[]): FilterOption<string>[] {
  return [{ id: ALL, label: 'All' }, ...[...new Set(values)].sort().map((v) => ({ id: v, label: v }))]
}

function parseSessionId(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data)
    if (parsed !== null && typeof parsed === 'object') {
      const id = Reflect.get(parsed, 'sessionId')
      if (typeof id === 'string') return id
    }
  } catch {
    // A malformed frame is not worth a console line.
  }
  return null
}

function upsertSession(prev: SessionSummary[], next: SessionSummary): SessionSummary[] {
  const idx = prev.findIndex((s) => s.sessionId === next.sessionId)
  if (idx === -1) return [next, ...prev]
  return prev.map((s, i) => (i === idx ? next : s))
}

function SessionRow({ row, now }: { row: Enriched; now: number }) {
  const { session } = row
  const title = session.preview === null || session.preview === '' ? session.sessionId : session.preview
  return (
    <tr className='border-t border-border/60 transition-colors hover:bg-muted/50'>
      <td className='py-3 pl-6 pr-3'>
        <Link to={`/activity/sessions/${encodeURIComponent(session.sessionId)}`} className='block'>
          <div className='truncate text-xs font-medium'>{title}</div>
          <div className='font-mono text-[11px] text-muted-foreground'>{session.sessionId}</div>
        </Link>
      </td>
      <td className='px-3'>
        <SurfaceCell path={row.surfacePath} />
      </td>
      <td className='truncate px-3 font-mono text-[11px] text-muted-foreground'>{row.model}</td>
      <td className='px-3 text-right font-mono text-xs tabular-nums'>{session.requestCount}</td>
      <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtTokens(session.totalInputTokens)}</td>
      <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtTokens(session.totalOutputTokens)}</td>
      <td className='px-3 text-right font-mono text-xs tabular-nums text-muted-foreground'>
        {session.avgCacheHitPct}%
      </td>
      <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtCost(session.totalCostUsd)}</td>
      <td className='px-3'>
        {row.trend === null ? null : <Sparkline points={row.trend} label={`${session.requestCount} calls`} />}
      </td>
      <td className='py-3 pl-3 pr-6 text-right text-[11px] text-muted-foreground'>{fmtAgo(session.lastAt, now)}</td>
    </tr>
  )
}

function SessionsTable({ rows, now }: { rows: Enriched[]; now: number }) {
  return (
    <table className='w-full table-fixed'>
      <colgroup>
        <col />
        <col className='w-40' />
        <col className='w-36' />
        <col className='w-16' />
        <col className='w-20' />
        <col className='w-20' />
        <col className='w-16' />
        <col className='w-24' />
        <col className='w-20' />
        <col className='w-16' />
      </colgroup>
      <thead>
        <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
          <th className='pb-2 pl-6 pr-3 text-left font-medium'>Session</th>
          <th className='px-3 text-left font-medium'>Endpoint</th>
          <th className='px-3 text-left font-medium'>Model</th>
          <th className='px-3 text-right font-medium'>Turns</th>
          <th className='px-3 text-right font-medium'>Input</th>
          <th className='px-3 text-right font-medium'>Output</th>
          <th className='px-3 text-right font-medium'>Cache</th>
          <th className='px-3 text-right font-medium'>Cost</th>
          <th className='px-3 text-left font-medium'>Trend</th>
          <th className='pb-2 pl-3 pr-6 text-right font-medium'>Last</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <SessionRow key={row.session.sessionId} row={row} now={now} />
        ))}
      </tbody>
    </table>
  )
}

function StatsRow({ totals, rangeLabel }: { totals: WindowTotals | null; rangeLabel: string }) {
  return (
    <div className='grid grid-cols-4 gap-px border-b border-border px-6 py-4'>
      <StatTile
        label='Requests'
        value={totals === null ? '–' : totals.requests.toLocaleString()}
        sub={rangeLabel.toLowerCase()}
      />
      <StatTile label='Tokens' value={totals === null ? '–' : fmtTokens(totals.tokens)} sub='in + out' />
      <StatTile
        label='Cost'
        value={totals === null ? '–' : fmtCost(totals.apiKeyCostUsd)}
        sub='API-key providers only'
      />
      <StatTile
        label='Cache hit'
        value={totals === null ? '–' : fmtRate(totals.cacheHitRate)}
        sub='weighted by input tokens'
      />
    </div>
  )
}

export function ActivitySessions() {
  const [range, setRange] = useState<RangeId>('7d')
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [logs, setLogs] = useState<ActivityRequestLog[]>([])
  const [totals, setTotals] = useState<WindowTotals | null>(null)
  const [totalSessions, setTotalSessions] = useState<number | undefined>(undefined)
  const [totalRequests, setTotalRequests] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // Frozen per load so every "last seen" label on the page is measured
  // from the instant the data describes.
  const [now, setNow] = useState(Date.now())
  const [surfaceFilter, setSurfaceFilter] = useState<string>(ALL)
  const [providerFilter, setProviderFilter] = useState<string>(ALL)
  const [modelFilter, setModelFilter] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [live, setLive] = useState(false)
  const surfaces = useSurfaces()

  const load = useCallback(() => {
    const spec = rangeSpec(range)
    Promise.all([
      api.getRequestLogSessions({ limit: SESSION_PAGE, sinceHours: spec.hours }),
      fetchUsageCost(spec.days),
      fetchRequestLogs(JOIN_LOG_LIMIT)
    ])
      .then(([sessionRes, costRes, logRes]) => {
        setSessions(sessionRes.sessions)
        setTotalSessions(sessionRes.total)
        setTotals(summariseUsageCost(costRes))
        setLogs(logRes.items)
        setTotalRequests(logRes.total)
        setNow(Date.now())
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [range])

  useEffect(load, [load])

  // Live tail. Patching only the session the event names keeps the table
  // from re-rendering on every streamed token, which is what a blanket
  // re-fetch would do.
  useEffect(() => {
    if (!live) return
    const apiKey = localStorage.getItem('apiKey')
    if (apiKey === null || apiKey === '') return
    const es = new EventSource(`/api/request-logs/events?apikey=${encodeURIComponent(apiKey)}`)
    es.onmessage = (e) => {
      const sessionId = parseSessionId(e.data)
      if (sessionId === null) return
      void api.getSessionSummary(sessionId).then((summary) => {
        setSessions((prev) => (prev === null ? prev : upsertSession(prev, summary)))
      })
    }
    // Left open on error: EventSource reconnects itself after a transient
    // network failure.
    return () => es.close()
  }, [live])

  const rows = useMemo(
    () => (sessions === null ? [] : enrich(sessions, logs, surfaces.pathOf)),
    [sessions, logs, surfaces.pathOf]
  )
  const visible = useMemo(
    () => applyFilters(rows, { surface: surfaceFilter, provider: providerFilter, model: modelFilter, query }),
    [rows, surfaceFilter, providerFilter, modelFilter, query]
  )

  const spec = rangeSpec(range)
  const subtitle =
    sessions === null
      ? undefined
      : `${fmtCount(totalSessions === undefined ? sessions.length : totalSessions)} sessions · ${totals === null ? '–' : fmtCount(totals.requests)} requests · ${spec.label.toLowerCase()}`

  const archiveAll = () => {
    if (!window.confirm('Archive every active session? Their cost totals are kept.')) return
    void api.archiveAllSessions().then(load)
  }

  const exportCsv = () => {
    downloadCsv('rialto-sessions.csv', [
      ['session', 'endpoint', 'model', 'calls', 'input', 'output', 'cachePct', 'costUsd', 'lastAt'],
      ...visible.map((r) => [
        r.session.sessionId,
        r.surfacePath === null ? '' : r.surfacePath,
        r.model === null ? '' : r.model,
        String(r.session.requestCount),
        String(r.session.totalInputTokens),
        String(r.session.totalOutputTokens),
        String(r.session.avgCacheHitPct),
        r.session.totalCostUsd === null ? '' : String(r.session.totalCostUsd),
        r.session.lastAt
      ])
    ])
  }

  return (
    <Screen
      title='Activity'
      subtitle={subtitle}
      actions={
        <>
          <RButton
            variant='outline'
            icon='ri-broadcast-line'
            aria-pressed={live}
            onClick={() => setLive((v) => !v)}
            className={live ? 'bg-muted/60' : ''}
          >
            Live tail
          </RButton>
          <RButton variant='ghost' icon='ri-archive-line' onClick={archiveAll}>
            Archive
          </RButton>
        </>
      }
    >
      <ActivityTabs active='sessions' sessionCount={totalSessions} requestCount={totalRequests} />

      <div className='flex flex-wrap items-center gap-2 border-b border-border px-6 py-3'>
        <FilterSelect
          label='Surface'
          value={surfaceFilter}
          options={options(surfaces.surfaces.map((s) => s.path))}
          onChange={setSurfaceFilter}
        />
        <FilterSelect
          label='Provider'
          value={providerFilter}
          options={options(rows.flatMap((r) => r.session.providers))}
          onChange={setProviderFilter}
        />
        <FilterSelect
          label='Model'
          value={modelFilter}
          options={options(rows.flatMap((r) => r.session.models))}
          onChange={setModelFilter}
        />
        <FilterSelect
          label='Range'
          value={range}
          options={RANGES.map((r) => ({ id: r.id, label: r.label }))}
          onChange={setRange}
        />
        <div className='ml-auto flex items-center gap-2'>
          <div className='flex h-7 w-56 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-muted-foreground'>
            <i className='ri-search-line text-sm' />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search sessions'
              className='min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground'
            />
          </div>
          <RButton variant='ghost' icon='ri-download-line' onClick={exportCsv} disabled={visible.length === 0}>
            Export
          </RButton>
        </div>
      </div>

      <StatsRow totals={totals} rangeLabel={spec.label} />

      {error !== null ? (
        <ScreenMessage tone='bad'>{error}</ScreenMessage>
      ) : sessions === null ? (
        <ScreenMessage>Loading…</ScreenMessage>
      ) : visible.length === 0 ? (
        <ScreenMessage>No sessions in this window.</ScreenMessage>
      ) : (
        <SessionsTable rows={visible} now={now} />
      )}
      <div className='h-10' />
    </Screen>
  )
}
