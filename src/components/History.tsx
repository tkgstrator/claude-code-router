import { ChevronRight, Clock, History, Layers, RefreshCw, Trash2, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { api, type RequestLogItem, type SessionSummary } from '@/lib/api'
import dayjs from '@/lib/dayjs'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtCost(usd: number | null): string {
  if (usd == null) return '–'
  if (usd < 0.00001) return '<$0.00001'
  return `$${usd.toFixed(5)}`
}

function fmtMs(ms: number): string {
  if (ms >= 1_000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function StatusBadge({ status }: { status: number }) {
  const ok = status >= 200 && status < 300
  return (
    <span
      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
    >
      {status}
    </span>
  )
}

function CacheBar({ pct }: { pct: number }) {
  return (
    <div className='flex items-center gap-1.5'>
      <div className='w-16 h-1.5 bg-border rounded-full overflow-hidden'>
        <div className='h-full rounded-full bg-amber-400' style={{ width: `${pct}%` }} />
      </div>
      <span className='text-xs text-muted-foreground'>{pct}%</span>
    </div>
  )
}

export function HistoryPage() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SessionSummary | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getRequestLogSessions({ limit: 100 })
      setSessions(res.sessions)
      setTotal(res.total)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleClearAll = async () => {
    if (!window.confirm(t('history.clear_confirm'))) return
    await api.deleteAllRequestLogs()
    setSessions([])
    setTotal(0)
    setSelected(null)
  }

  return (
    <div className='flex h-full'>
      {/* Left: session list */}
      <aside className='w-72 flex-shrink-0 border-r flex flex-col'>
        <div className='flex items-center justify-between px-4 py-3 border-b'>
          <div className='flex items-center gap-2'>
            <History className='h-4 w-4' />
            <span className='font-semibold text-sm'>{t('history.title')}</span>
            {total > 0 && <span className='text-xs text-muted-foreground'>({total})</span>}
          </div>
          <div className='flex items-center gap-1'>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={handleClearAll}
              disabled={sessions.length === 0}
            >
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          </div>
        </div>

        <div className='flex-1 overflow-y-auto'>
          {loading ? (
            <div className='flex items-center justify-center h-32 text-muted-foreground text-sm'>
              {t('history.loading')}
            </div>
          ) : sessions.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-48 text-muted-foreground gap-2'>
              <History className='h-10 w-10 text-muted-foreground/30' />
              <p className='text-sm'>{t('history.no_history')}</p>
            </div>
          ) : (
            <ul>
              {sessions.map((session) => {
                const isActive = selected?.sessionId === session.sessionId
                return (
                  <li
                    key={session.sessionId ?? '_null_'}
                    className={`group relative px-4 py-2.5 cursor-pointer border-b transition-colors ${
                      isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    }`}
                    onClick={() => setSelected(session)}
                  >
                    <div className='flex items-start justify-between gap-1'>
                      <div className='min-w-0 flex-1'>
                        <p className={`text-sm font-medium ${isActive ? 'text-accent-foreground' : 'text-foreground'}`}>
                          {dayjs(session.lastAt).format('MM/DD HH:mm')}
                        </p>
                        <p
                          className={`text-[11px] mt-0.5 ${isActive ? 'text-muted-foreground' : 'text-muted-foreground'}`}
                        >
                          <Layers className='h-3 w-3 inline mr-1' />
                          {session.requestCount} req
                          {'　'}
                          {fmtTokens(session.totalInputTokens + session.totalOutputTokens)} tok
                          {session.totalCostUsd != null && `　${fmtCost(session.totalCostUsd)}`}
                        </p>
                      </div>
                      <ChevronRight
                        className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${isActive ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Right: detail */}
      <main className='flex-1 overflow-y-auto p-6'>
        {!selected ? (
          <div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-3'>
            <Zap className='h-12 w-12 text-muted-foreground/30' />
            <p className='text-sm'>{t('history.select_session')}</p>
          </div>
        ) : (
          <SessionDetail session={selected} />
        )}
      </main>
    </div>
  )
}

function SessionDetail({ session }: { session: SessionSummary }) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<RequestLogItem[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!session.sessionId) return
    setLoadingLogs(true)
    api
      .getSessionLogs(session.sessionId)
      .then((res) => setLogs(res.items))
      .catch(() => {})
      .finally(() => setLoadingLogs(false))
  }, [session.sessionId])

  const summaryRows = [
    {
      label: t('history.detail.time'),
      value: `${dayjs(session.firstAt).format('YYYY/MM/DD HH:mm')} – ${dayjs(session.lastAt).format('HH:mm')}`
    },
    { label: t('history.detail.duration'), value: fmtMs(session.totalDurationMs) },
    { label: t('history.detail.requests'), value: String(session.requestCount) }
  ]

  const tokenRows = [
    { label: t('history.detail.input_tokens'), value: fmtTokens(session.totalInputTokens) },
    { label: t('history.detail.output_tokens'), value: fmtTokens(session.totalOutputTokens) },
    { label: t('history.detail.cache_read'), value: fmtTokens(session.totalCacheReadTokens) },
    { label: t('history.detail.cache_write'), value: fmtTokens(session.totalCacheWriteTokens) }
  ]

  return (
    <div className='max-w-2xl mx-auto space-y-6'>
      {/* Header */}
      <div className='flex items-start justify-between'>
        <div>
          <p className='text-xs text-muted-foreground font-mono truncate max-w-xs'>
            {session.sessionId ?? '(no session)'}
          </p>
          <h2 className='text-xl font-semibold text-foreground'>{dayjs(session.lastAt).format('YYYY/MM/DD HH:mm')}</h2>
        </div>
        <div className='text-right'>
          {session.totalCostUsd != null && (
            <p className='text-2xl font-bold text-foreground'>{fmtCost(session.totalCostUsd)}</p>
          )}
          <p className='text-xs text-muted-foreground'>{t('history.detail.estimated_cost')}</p>
        </div>
      </div>

      {/* Summary */}
      <div className='bg-muted rounded-lg divide-y'>
        {summaryRows.map((row) => (
          <div key={row.label} className='flex items-center justify-between px-4 py-2.5 text-sm'>
            <span className='text-muted-foreground'>{row.label}</span>
            <span className='font-medium text-foreground'>{row.value}</span>
          </div>
        ))}
      </div>

      {/* Token stats */}
      <div>
        <h3 className='text-sm font-semibold text-foreground mb-2'>{t('history.detail.tokens')}</h3>
        <div className='bg-muted rounded-lg divide-y'>
          {tokenRows.map((row) => (
            <div key={row.label} className='flex items-center justify-between px-4 py-2.5 text-sm'>
              <span className='text-muted-foreground'>{row.label}</span>
              <span className='font-mono font-medium text-foreground'>{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cache hit rate */}
      <div>
        <h3 className='text-sm font-semibold text-foreground mb-2'>{t('history.detail.cache')}</h3>
        <div className='bg-muted rounded-lg px-4 py-3 flex items-center gap-4'>
          <CacheBar pct={session.avgCacheHitPct} />
          <span className='text-sm text-muted-foreground'>{t('history.detail.cache_hit_rate')}</span>
        </div>
      </div>

      {/* Individual requests */}
      {session.sessionId && (
        <div>
          <h3 className='text-sm font-semibold text-foreground mb-2'>{t('history.detail.requests_list')}</h3>
          {loadingLogs ? (
            <p className='text-sm text-muted-foreground'>{t('history.loading')}</p>
          ) : (
            <div className='space-y-1'>
              {logs.map((log) => (
                <div key={log.id} className='border rounded-lg overflow-hidden'>
                  <button
                    type='button'
                    className='w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted transition-colors'
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  >
                    <div className='flex items-center gap-2'>
                      <Clock className='h-3.5 w-3.5 text-muted-foreground' />
                      <span className='text-muted-foreground text-[11px]'>
                        {dayjs(log.createdAt).format('HH:mm:ss')}
                      </span>
                      <span className='font-mono text-xs text-foreground'>{log.model}</span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='text-xs text-muted-foreground'>
                        {fmtTokens(log.totalInputTokens)}↑ {fmtTokens(log.outputTokens)}↓
                      </span>
                      <StatusBadge status={log.status} />
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded === log.id ? 'rotate-90' : ''}`}
                      />
                    </div>
                  </button>
                  {expanded === log.id && (
                    <div className='border-t bg-muted px-4 py-3 grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs'>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('history.detail.input_tokens')}</span>
                        <span className='font-mono'>{fmtTokens(log.inputTokens)}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('history.detail.output_tokens')}</span>
                        <span className='font-mono'>{fmtTokens(log.outputTokens)}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('history.detail.cache_read')}</span>
                        <span className='font-mono'>{fmtTokens(log.cacheReadTokens)}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('history.detail.cache_write')}</span>
                        <span className='font-mono'>{fmtTokens(log.cacheWriteTokens)}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('history.detail.duration')}</span>
                        <span className='font-mono'>{fmtMs(log.durationMs)}</span>
                      </div>
                      {log.totalCostUsd != null && (
                        <div className='flex justify-between'>
                          <span className='text-muted-foreground'>{t('history.detail.estimated_cost')}</span>
                          <span className='font-mono'>{fmtCost(log.totalCostUsd)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
