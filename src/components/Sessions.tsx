import { Archive, Layers, MessagesSquare, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api, type InboundType, type SessionSummary } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { fmtCost, fmtMs, fmtTokens } from '@/lib/sessions/format'

function CacheBar({ pct }: { pct: number }) {
  return (
    <div className='flex items-center gap-2'>
      <div className='h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-border'>
        <div className='h-full rounded-full bg-amber-400' style={{ width: `${pct}%` }} />
      </div>
      <span className='shrink-0 tabular-nums'>{pct}%</span>
    </div>
  )
}

// Compact date-range label. Same-day sessions collapse to `HH:mm – HH:mm`
// (fits inside a card without wrapping); cross-day sessions keep the start
// date so the range stays unambiguous.
function fmtSessionRange(firstAt: string, lastAt: string): string {
  const start = dayjs(firstAt)
  const end = dayjs(lastAt)
  if (start.isSame(end, 'day')) return `${start.format('HH:mm')} – ${end.format('HH:mm')}`
  return `${start.format('MM/DD HH:mm')} – ${end.format('MM/DD HH:mm')}`
}

// Which inbound wire types the History tab currently shows. `undefined`
// = mix both (server returns all). The tab persists in state only —
// URL parameters are noise for a per-user preference this transient.
type InboundFilter = 'all' | InboundType

// How far back the session list reaches. 0 = no time filter (the server
// treats sinceHours=0 as "all history").
type RangeHours = 6 | 24 | 168 | 0

export function SessionsPage() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [inboundFilter, setInboundFilter] = useState<InboundFilter>('all')
  const [rangeHours, setRangeHours] = useState<RangeHours>(6)

  const load = useCallback(async (filter: InboundFilter, range: RangeHours) => {
    setLoading(true)
    try {
      const res = await api.getRequestLogSessions({
        limit: 100,
        sinceHours: range,
        inboundType: filter === 'all' ? undefined : filter
      })
      setSessions(res.sessions)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(inboundFilter, rangeHours)
  }, [load, inboundFilter, rangeHours])

  // SSE: patch the session list in-place whenever a new RequestLog is
  // written. Fetching only the affected session's summary keeps the grid
  // from flashing/re-rendering on every streaming token.
  useEffect(() => {
    const apiKey = localStorage.getItem('apiKey') ?? ''
    if (!apiKey) return
    const es = new EventSource(`/api/request-logs/events?apikey=${encodeURIComponent(apiKey)}`)
    es.onmessage = (e) => {
      try {
        const { sessionId } = JSON.parse(e.data) as { sessionId: string }
        void api.getSessionSummary(sessionId).then((summary) => {
          // Respect the active filter: a summary that doesn't match the
          // current tab is either dropped (new row we wouldn't have
          // fetched) or removed (existing row that shouldn't stay
          // visible on the wrong tab).
          const matchesFilter = inboundFilter === 'all' || summary.inboundType === inboundFilter
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.sessionId === sessionId)
            if (!matchesFilter) {
              if (idx === -1) return prev
              const next = [...prev]
              next.splice(idx, 1)
              return next
            }
            if (idx === -1) return [summary, ...prev]
            const next = [...prev]
            next[idx] = summary
            return next
          })
        })
      } catch {}
    }
    // Do not close on error: the browser's EventSource reconnects
    // automatically after transient network failures.
    return () => es.close()
  }, [inboundFilter])

  const handleArchiveAll = async () => {
    if (!window.confirm(t('sessions.archive_confirm'))) return
    await api.archiveAllSessions()
    setSessions([])
  }

  const filterOptions: readonly { key: InboundFilter; label: string }[] = [
    { key: 'all', label: t('sessions.filter.all') },
    { key: 'anthropic', label: t('sessions.filter.claudeCode') },
    { key: 'openai', label: t('sessions.filter.api') }
  ]

  const rangeOptions: readonly { key: RangeHours; label: string }[] = [
    { key: 6, label: t('sessions.range.h6') },
    { key: 24, label: t('sessions.range.h24') },
    { key: 168, label: t('sessions.range.d7') },
    { key: 0, label: t('sessions.range.all') }
  ]

  return (
    <PageContainer>
      <PageHeader fluid title={t('sessions.title')}>
        <Button variant='outline' onClick={() => load(inboundFilter, rangeHours)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('sessions.refresh')}
        </Button>
        <Button variant='outline' onClick={handleArchiveAll} disabled={sessions.length === 0}>
          <Archive className='h-4 w-4' />
          {t('sessions.archive_all')}
        </Button>
      </PageHeader>

      <PageContent fluid>
        <div className='mb-4 flex flex-wrap items-center gap-1 border-b'>
          {filterOptions.map((o) => {
            const active = inboundFilter === o.key
            return (
              <button
                key={o.key}
                type='button'
                onClick={() => setInboundFilter(o.key)}
                className={
                  active
                    ? '-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium'
                    : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
                }
              >
                {o.label}
              </button>
            )
          })}
          <div className='ml-auto flex items-center gap-0.5 pb-1'>
            {rangeOptions.map((o) => {
              const active = rangeHours === o.key
              return (
                <button
                  key={o.key}
                  type='button'
                  onClick={() => setRangeHours(o.key)}
                  className={
                    active
                      ? 'rounded bg-muted px-2 py-1 text-xs font-medium text-foreground tabular-nums'
                      : 'rounded px-2 py-1 text-xs text-muted-foreground tabular-nums hover:bg-muted/50 hover:text-foreground'
                  }
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
        {loading && sessions.length === 0 ? (
          <div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
            {t('sessions.loading')}
          </div>
        ) : sessions.length === 0 ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground'>
            <MessagesSquare className='h-10 w-10 text-muted-foreground/30' />
            <p className='text-sm'>{t('sessions.no_history')}</p>
          </div>
        ) : (
          <div className='grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4'>
            {sessions.map((session) => (
              <SessionCard key={session.sessionId} session={session} />
            ))}
          </div>
        )}
      </PageContent>
    </PageContainer>
  )
}

function inboundBadgeLabel(t: (k: string) => string, kind: InboundType | null): string | null {
  if (kind === 'anthropic') return t('sessions.filter.claudeCode')
  if (kind === 'openai') return t('sessions.filter.api')
  return null
}

function SessionCard({ session }: { session: SessionSummary }) {
  const { t } = useTranslation()
  const hasPreview = session.preview !== null && session.preview.length > 0
  const badge = inboundBadgeLabel(t, session.inboundType)
  return (
    <Link
      to={`/sessions/${encodeURIComponent(session.sessionId)}`}
      className='group block space-y-3 border-l-2 border-transparent px-3 py-3 transition-colors hover:border-primary hover:bg-muted/50'
    >
      {/* Header row: date + total cost */}
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <p className='text-sm font-semibold text-foreground tabular-nums'>
              {dayjs(session.lastAt).format('YYYY/MM/DD HH:mm')}
            </p>
            {badge !== null && (
              <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>{badge}</span>
            )}
          </div>
          <p className='truncate font-mono text-[10px] text-muted-foreground'>{session.sessionId}</p>
        </div>
        {session.totalCostUsd != null && (
          <p className='shrink-0 text-lg font-bold text-foreground tabular-nums'>{fmtCost(session.totalCostUsd)}</p>
        )}
      </div>

      {/* Stats grid — label / value rows keep the eye scanning vertically */}
      <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t pt-3 text-xs'>
        <dt className='text-muted-foreground'>{t('sessions.detail.time')}</dt>
        <dd className='truncate text-right font-mono tabular-nums'>
          {fmtSessionRange(session.firstAt, session.lastAt)}
        </dd>

        <dt className='text-muted-foreground'>{t('sessions.detail.duration')}</dt>
        <dd className='text-right font-mono tabular-nums'>{fmtMs(session.totalDurationMs)}</dd>

        <dt className='text-muted-foreground'>{t('sessions.detail.requests')}</dt>
        <dd className='flex items-center justify-end gap-1 font-mono tabular-nums'>
          <Layers className='h-3 w-3 text-muted-foreground' />
          {session.requestCount.toLocaleString()}
        </dd>

        <dt className='text-muted-foreground'>{t('sessions.detail.tokens')}</dt>
        <dd className='text-right font-mono tabular-nums'>
          {fmtTokens(session.totalInputTokens)}
          <span className='text-muted-foreground'>↑ </span>
          {fmtTokens(session.totalOutputTokens)}
          <span className='text-muted-foreground'>↓</span>
        </dd>

        <dt className='text-muted-foreground'>{t('sessions.detail.cache_hit_rate')}</dt>
        <dd className='flex justify-end'>
          <CacheBar pct={session.avgCacheHitPct} />
        </dd>
      </dl>

      {/* Models used in this session, as compact pills */}
      {session.models.length > 0 && (
        <div className='flex flex-wrap gap-1 border-t pt-3'>
          {session.models.map((model) => (
            <span key={model} className='rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'>
              {model}
            </span>
          ))}
        </div>
      )}

      {/* First user turn preview — the only free-form text on the card,
          clamped so it can't blow the card's vertical rhythm. */}
      <p
        className={`line-clamp-2 border-t pt-3 text-xs leading-snug ${
          hasPreview ? 'text-foreground/80' : 'italic text-muted-foreground'
        }`}
      >
        {hasPreview ? session.preview : t('sessions.preview_empty')}
      </p>
    </Link>
  )
}
