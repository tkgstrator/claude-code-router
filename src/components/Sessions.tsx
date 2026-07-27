import { Archive, ChevronDown, ChevronRight, Layers, MessagesSquare, RefreshCw, Wrench, Zap } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownViewer } from '@/components/MarkdownViewer'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api, type RequestLogItem, type SessionMessageItem, type SessionSummary } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { fmtChars, fmtCost, fmtMs, fmtTokens } from '@/lib/sessions/format'
import { blockKey, type NormalisedBlock, normaliseContent } from '@/lib/sessions/message-content'

function CacheBar({ pct }: { pct: number }) {
  return (
    <div className='space-y-1.5'>
      <span>{pct}%</span>
      <div className='h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-border'>
        <div className='h-full rounded-full bg-amber-400' style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// KPI-style stat cell: muted label on top, prominent value below. Flat by
// default (no card frame) — the grid gap + label/value hierarchy carries
// the visual separation. Values that need a different scale (long time
// ranges, embedded bars) override via `valueClassName`.
function StatTile({
  label,
  value,
  valueClassName = 'text-lg'
}: {
  label: string
  value: ReactNode
  valueClassName?: string
}) {
  return (
    <div>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <div className={`mt-1 font-semibold text-foreground tabular-nums ${valueClassName}`}>{value}</div>
    </div>
  )
}

// Compact date-range label. Same-day sessions collapse to `HH:mm – HH:mm`
// (fits inside a narrow stat tile without wrapping); cross-day sessions
// keep the start date so the range stays unambiguous.
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
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  const [detailRefresh, setDetailRefresh] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getRequestLogSessions({ limit: 100, sinceHours: 6 })
      setSessions(res.sessions)
      // Keep selected in sync with latest aggregated stats.
      setSelected((prev) => (prev ? (res.sessions.find((s) => s.sessionId === prev.sessionId) ?? prev) : null))
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // SSE: patch the session list in-place whenever a new RequestLog is written.
  // We fetch only the affected session's summary instead of reloading the full
  // list so the sidebar doesn't flash/re-render on every streaming token.
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
        setSelected((prev) => {
          if (prev?.sessionId === sessionId) setDetailRefresh((n) => n + 1)
          return prev
        })
      } catch {}
    }
    // Do not close on error: the browser's EventSource reconnects
    // automatically after transient network failures. Calling es.close()
    // here suppressed that reconnection, so History stopped updating
    // whenever the server restarted or the connection briefly dropped.
    // For persistent auth failures (401) the server returns a non-SSE
    // response, which the browser treats as a permanent error and stops
    // retrying without any explicit close() call.
    return () => es.close()
  }, [])

  const handleArchiveAll = async () => {
    if (!window.confirm(t('sessions.archive_confirm'))) return
    await api.archiveAllSessions()
    setSessions([])
    setSelected(null)
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

      {/* Master–detail body: two independently scrollable panes below the
          shared header. PageContent is intentionally not used here — its
          single scroll container can't host two separate scroll areas. */}
      <div className='flex min-h-0 flex-1'>
        {/* Left: session list */}
        <aside className='flex w-80 shrink-0 flex-col border-r xl:w-96'>
          <div className='flex-1 overflow-y-auto p-2'>
            {loading ? (
              <div className='flex h-32 items-center justify-center text-sm text-muted-foreground'>
                {t('sessions.loading')}
              </div>
            ) : sessions.length === 0 ? (
              <div className='flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground'>
                <MessagesSquare className='h-10 w-10 text-muted-foreground/30' />
                <p className='text-sm'>{t('sessions.no_history')}</p>
              </div>
            ) : (
              <ul className='space-y-1'>
                {sessions.map((session) => {
                  const isActive = selected?.sessionId === session.sessionId
                  const hasPreview = session.preview !== null && session.preview.length > 0
                  return (
                    <li key={session.sessionId}>
                      <button
                        type='button'
                        className={`w-full rounded-md px-3 py-2.5 text-left transition-colors ${
                          isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => setSelected(session)}
                      >
                        <p
                          className={`text-sm leading-snug line-clamp-2 ${
                            hasPreview ? 'text-foreground' : 'italic text-muted-foreground'
                          }`}
                        >
                          {hasPreview ? session.preview : t('sessions.preview_empty')}
                        </p>
                        <p className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums'>
                          <span className='whitespace-nowrap'>{dayjs(session.lastAt).format('MM/DD HH:mm')}</span>
                          <span className='opacity-40'>·</span>
                          <span className='flex items-center gap-0.5'>
                            <Layers className='h-3 w-3' />
                            {session.requestCount}
                          </span>
                          <span>{fmtTokens(session.totalInputTokens + session.totalOutputTokens)} tok</span>
                          {session.totalCostUsd != null && <span>{fmtCost(session.totalCostUsd)}</span>}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Right: detail */}
        <main className='min-w-0 flex-1 overflow-y-auto'>
          {!selected ? (
            <div className='flex h-full flex-col items-center justify-center gap-3 text-muted-foreground'>
              <Zap className='h-12 w-12 text-muted-foreground/30' />
              <p className='text-sm'>{t('sessions.select_session')}</p>
            </div>
          ) : (
            <div className='px-6 py-6'>
              <SessionDetail session={selected} refreshTrigger={detailRefresh} />
            </div>
          )}
        </main>
      </div>
    </PageContainer>
  )
}

function SessionDetail({ session, refreshTrigger }: { session: SessionSummary; refreshTrigger?: number }) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<RequestLogItem[]>([])
  const [messages, setMessages] = useState<SessionMessageItem[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  const loadedSessionRef = useRef<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is a refetch signal, not read in the body
  useEffect(() => {
    // Only show the blocking loader when switching to a different session.
    // SSE-driven refreshes (refreshTrigger bumps) refetch silently and swap
    // the logs in place, so the request list never blanks/flickers mid-stream.
    const isSwitch = loadedSessionRef.current !== session.sessionId
    let cancelled = false
    if (isSwitch) {
      setLoadingLogs(true)
    }
    // Logs and messages come from separate tables; fetch in parallel so the
    // chat view doesn't wait on the metrics query and vice versa.
    Promise.all([api.getSessionLogs(session.sessionId), api.getSessionMessages(session.sessionId)])
      .then(([logsRes, msgsRes]) => {
        if (cancelled) return
        loadedSessionRef.current = session.sessionId
        setLogs(logsRes.items)
        setMessages(msgsRes.items)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled && isSwitch) setLoadingLogs(false)
      })
    return () => {
      cancelled = true
    }
  }, [session.sessionId, refreshTrigger])

  const modelBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { requests: number; inputTokens: number; outputTokens: number; cost: number | null; cacheHitPctSum: number }
    >()
    for (const log of logs) {
      const prev = map.get(log.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0, cost: null, cacheHitPctSum: 0 }
      prev.requests += 1
      prev.inputTokens += log.totalInputTokens
      prev.outputTokens += log.outputTokens
      prev.cacheHitPctSum += log.cacheHitPct
      if (log.totalCostUsd != null) prev.cost = (prev.cost ?? 0) + log.totalCostUsd
      map.set(log.model, prev)
    }
    return [...map.entries()]
      .map(([model, { cacheHitPctSum, requests, ...rest }]) => ({
        model,
        requests,
        ...rest,
        avgCacheHitPct: requests > 0 ? Math.round(cacheHitPctSum / requests) : 0
      }))
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
  }, [logs])

  const overviewTiles = [
    {
      label: t('sessions.detail.time'),
      value: fmtSessionRange(session.firstAt, session.lastAt),
      valueClassName: 'text-base whitespace-nowrap'
    },
    { label: t('sessions.detail.duration'), value: fmtMs(session.totalDurationMs) },
    { label: t('sessions.detail.requests'), value: String(session.requestCount) },
    {
      label: t('sessions.detail.cache_hit_rate'),
      value: <CacheBar pct={session.avgCacheHitPct} />
    }
  ]

  const tokenTiles = [
    { label: t('sessions.detail.input_tokens'), value: fmtTokens(session.totalInputTokens) },
    { label: t('sessions.detail.output_tokens'), value: fmtTokens(session.totalOutputTokens) },
    { label: t('sessions.detail.cache_read'), value: fmtTokens(session.totalCacheReadTokens) },
    { label: t('sessions.detail.cache_write'), value: fmtTokens(session.totalCacheWriteTokens) }
  ]

  return (
    <div className='space-y-6'>
      {/* Header — plain top block, no card/frame styling. The trailing
          `space-y-6` on the parent handles rhythm between sections. */}
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0'>
          <h2 className='text-xl font-semibold text-foreground'>{dayjs(session.lastAt).format('YYYY/MM/DD HH:mm')}</h2>
          <p className='truncate font-mono text-xs text-muted-foreground'>{session.sessionId}</p>
        </div>
        <div className='text-right'>
          {session.totalCostUsd != null && (
            <p className='text-2xl font-bold text-foreground tabular-nums'>{fmtCost(session.totalCostUsd)}</p>
          )}
          <p className='text-xs text-muted-foreground'>{t('sessions.detail.estimated_cost')}</p>
        </div>
      </div>

      {/* Overview stat tiles */}
      <div className='grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3'>
        {overviewTiles.map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={tile.value} valueClassName={tile.valueClassName} />
        ))}
      </div>

      {/* Token stats */}
      <section className='space-y-3'>
        <h3 className='border-b pb-2 text-base font-semibold text-foreground'>{t('sessions.detail.tokens')}</h3>
        <div className='grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3'>
          {tokenTiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} valueClassName='font-mono text-lg' />
          ))}
        </div>
      </section>

      {/* Per-model breakdown */}
      {modelBreakdown.length > 0 && (
        <section className='space-y-3'>
          <h3 className='border-b pb-2 text-base font-semibold text-foreground'>
            {t('sessions.detail.model_breakdown')}
          </h3>
          <div className='divide-y'>
            {modelBreakdown.map((entry) => (
              <div key={entry.model} className='flex items-center gap-3 py-2 text-xs'>
                <span className='min-w-0 flex-1 truncate font-mono text-foreground'>{entry.model}</span>
                <span className='w-14 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums'>
                  {entry.requests} req
                </span>
                <span className='w-16 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums'>
                  {fmtTokens(entry.inputTokens)}↑
                </span>
                <span className='w-14 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums'>
                  {fmtTokens(entry.outputTokens)}↓
                </span>
                <span className='w-10 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums'>
                  {entry.avgCacheHitPct}%
                </span>
                <span className='w-20 shrink-0 whitespace-nowrap text-right font-mono text-foreground tabular-nums'>
                  {fmtCost(entry.cost)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Conversation */}
      <ConversationSection messages={messages} logs={logs} loading={loadingLogs} />
    </div>
  )
}

// ── Conversation view ────────────────────────────────────────────────────────
// Chat-style rendering of the archived user + assistant turns for a session.
// Content shapes:
//   - string                              → rendered verbatim as one text line
//   - Anthropic block array               → per-block bubble (text / tool_use / tool_result)
//   - anything else                       → JSON-serialised fallback so debugging isn't blind

function ConversationSection({
  messages,
  logs,
  loading
}: {
  messages: SessionMessageItem[]
  logs: RequestLogItem[]
  loading: boolean
}) {
  const { t } = useTranslation()
  const [showDeveloper, setShowDeveloper] = useState(false)

  // Pair each assistant turn with its request log. There is no shared id
  // between the Message and RequestLog tables, but both are written once
  // per successful request, so zipping the two createdAt-ordered sequences
  // lines them up 1:1. Logs arrive newest-first and messages oldest-first,
  // so sort logs ascending before zipping. Used to annotate assistant
  // bubbles with the model + cost that produced them.
  const logByMessageId = useMemo(() => {
    const logsAsc = [...logs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const map = new Map<string, RequestLogItem>()
    let i = 0
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      const log = logsAsc[i]
      if (log) map.set(m.id, log)
      i += 1
    }
    return map
  }, [messages, logs])

  // Normalise once so the toggle only re-filters, never re-parses. Rows
  // whose visible-in-current-mode block list is empty are dropped entirely
  // so a tool-only turn doesn't leave an empty bubble behind.
  const normalised = useMemo(
    () =>
      messages.map((m) => ({ id: m.id, role: m.role, createdAt: m.createdAt, blocks: normaliseContent(m.content) })),
    [messages]
  )
  const hasDeveloperContent = useMemo(
    () => normalised.some((m) => m.blocks.some((b) => b.kind !== 'text')),
    [normalised]
  )
  const displayed = useMemo(() => {
    if (showDeveloper) return normalised.filter((m) => m.blocks.length > 0)
    return normalised
      .map((m) => ({ ...m, blocks: m.blocks.filter((b) => b.kind === 'text') }))
      .filter((m) => m.blocks.length > 0)
  }, [normalised, showDeveloper])

  // Chat-app scrolling: pin the view to the newest turn at the bottom when a
  // session's messages load, so the latest is visible and older history is
  // reached by scrolling up. Keyed on the message data (not the developer
  // toggle) so flipping developer mode doesn't yank the view to the bottom.
  const scrollRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin only when the message set changes, not on developer-toggle re-renders
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <section>
      <div className='mb-3 flex items-center justify-between border-b pb-2'>
        <h3 className='text-base font-semibold text-foreground'>{t('sessions.detail.conversation')}</h3>
        {hasDeveloperContent && (
          <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={() => setShowDeveloper((v) => !v)}>
            {showDeveloper ? t('sessions.detail.hide_developer') : t('sessions.detail.show_developer')}
          </Button>
        )}
      </div>
      {loading && messages.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t('sessions.loading')}</p>
      ) : displayed.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t('sessions.detail.conversation_empty')}</p>
      ) : (
        <div ref={scrollRef} className='max-h-[70vh] space-y-2 overflow-y-auto pr-1'>
          {displayed.map((m) => (
            <MessageBubble
              key={m.id}
              id={m.id}
              role={m.role}
              createdAt={m.createdAt}
              blocks={m.blocks}
              log={m.role === 'assistant' ? logByMessageId.get(m.id) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function MessageBubble({
  id,
  role,
  createdAt,
  blocks,
  log
}: {
  id: string
  role: SessionMessageItem['role']
  createdAt: string
  blocks: NormalisedBlock[]
  log?: RequestLogItem
}) {
  const isUser = role === 'user'
  const alignment = isUser ? 'items-end' : 'items-start'
  const bubble = isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
  // Assistant turns carry the model + cost of the request that produced
  // them (paired by order in ConversationSection). Cost is dropped when
  // the price map has no entry for the model.
  const meta = [
    dayjs(createdAt).format('HH:mm:ss'),
    log?.model,
    log != null && log.totalCostUsd != null ? fmtCost(log.totalCostUsd) : undefined
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className={`flex flex-col ${alignment} gap-1`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm space-y-1.5 ${bubble}`}>
        {blocks.map((b) => (
          <MessageBlock key={blockKey(id, b)} block={b} />
        ))}
      </div>
      <span className='text-[10px] text-muted-foreground tabular-nums font-mono'>{meta}</span>
    </div>
  )
}

function MessageBlock({ block }: { block: NormalisedBlock }) {
  const { t } = useTranslation()
  if (block.kind === 'text') {
    // Chat prose is Markdown (assistant replies especially). The viewer
    // inherits the bubble's text color, so it stays legible on both the muted
    // assistant bubble and the inverted (bg-primary) user bubble.
    return <MarkdownViewer content={block.text} />
  }
  if (block.kind === 'system_text') {
    return (
      <CollapsibleBlock
        header={
          <>
            <span className='shrink-0'>{t('sessions.detail.system_block')}</span>
            <span className='truncate opacity-70 font-mono'>{block.preview}</span>
            <span className='ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0'>
              {fmtChars(block.text.length)}
            </span>
          </>
        }
      >
        <pre className='font-mono text-[10px] whitespace-pre-wrap break-all opacity-80'>{block.text}</pre>
      </CollapsibleBlock>
    )
  }
  if (block.kind === 'tool_use') {
    return (
      <CollapsibleBlock
        header={
          <>
            <Wrench className='h-3 w-3 shrink-0' />
            <span className='truncate'>
              {t('sessions.detail.tool_call')}: <span className='font-mono'>{block.name}</span>
            </span>
            {block.truncated && (
              <span className='text-[10px] text-muted-foreground shrink-0'>
                ({t('sessions.detail.input_truncated')})
              </span>
            )}
            <span className='ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0'>
              {fmtChars(block.input.length)}
            </span>
          </>
        }
      >
        <pre className='font-mono text-[10px] whitespace-pre-wrap break-all opacity-80'>{block.input}</pre>
      </CollapsibleBlock>
    )
  }
  if (block.kind === 'tool_result') {
    return (
      <CollapsibleBlock
        header={
          <>
            <span className='truncate'>{t('sessions.detail.tool_result')}</span>
            <span className='ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0'>
              {fmtChars(block.text.length)}
            </span>
          </>
        }
      >
        <pre className='font-mono text-[10px] whitespace-pre-wrap break-all opacity-80'>{block.text}</pre>
      </CollapsibleBlock>
    )
  }
  return <pre className='font-mono text-[10px] whitespace-pre-wrap break-all opacity-70'>{block.text}</pre>
}

function CollapsibleBlock({ header, children }: { header: ReactNode; children: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className='rounded border border-current/20 bg-black/5 dark:bg-white/5 text-xs'>
      <button
        type='button'
        aria-expanded={open}
        aria-label={open ? t('sessions.detail.hide_details') : t('sessions.detail.show_details')}
        className='w-full flex items-center gap-1.5 px-2 py-1.5 font-medium text-left hover:bg-black/5 dark:hover:bg-white/5 rounded'
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className='h-3 w-3 shrink-0' /> : <ChevronRight className='h-3 w-3 shrink-0' />}
        {header}
      </button>
      {open && <div className='border-t border-current/10 px-2 py-1.5 space-y-1'>{children}</div>}
    </div>
  )
}
