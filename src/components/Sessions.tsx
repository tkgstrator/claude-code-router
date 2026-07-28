import { Archive, Layers, MessagesSquare, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api, type SessionSummary } from '@/lib/api'
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

export function SessionsPage() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getRequestLogSessions({ limit: 100, sinceHours: 6 })
      setSessions(res.sessions)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.sessionId === sessionId)
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
  }, [])

  const handleArchiveAll = async () => {
    if (!window.confirm(t('sessions.archive_confirm'))) return
    await api.archiveAllSessions()
    setSessions([])
  }

  return (
    <PageContainer>
      <PageHeader fluid title={t('sessions.title')}>
        <Button variant='outline' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('sessions.refresh')}
        </Button>
        <Button variant='outline' onClick={handleArchiveAll} disabled={sessions.length === 0}>
          <Archive className='h-4 w-4' />
          {t('sessions.archive_all')}
        </Button>
      </PageHeader>

      <PageContent fluid>
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

function SessionCard({ session }: { session: SessionSummary }) {
  const { t } = useTranslation()
  const hasPreview = session.preview !== null && session.preview.length > 0
  return (
    <div className='group space-y-3 border-l-2 border-transparent px-3 py-3 transition-colors hover:border-primary hover:bg-muted/50'>
      {/* Header row: date + total cost */}
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='text-sm font-semibold text-foreground tabular-nums'>
            {dayjs(session.lastAt).format('YYYY/MM/DD HH:mm')}
          </p>
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
    </div>
  )
}
