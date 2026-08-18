import { ArrowLeft, ChevronDown, ChevronRight, MessagesSquare, Wrench } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { MarkdownViewer } from '@/components/MarkdownViewer'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api, type RequestLogItem, type SessionMessageItem, type SessionSummary } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { fmtChars, fmtCost, fmtMs, fmtTokens } from '@/lib/sessions/format'
import { blockKey, type NormalisedBlock, normaliseContent } from '@/lib/sessions/message-content'

const MESSAGE_PAGE_SIZE = 50

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

// KPI-style stat cell: muted label on top, prominent value below. Flat by
// default (no card frame) — the grid gap + label/value hierarchy carries
// the visual separation.
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
    <div className='border-l-2 border-border pl-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <div className={`mt-1 font-semibold text-foreground tabular-nums ${valueClassName}`}>{value}</div>
    </div>
  )
}

function fmtSessionRange(firstAt: string, lastAt: string): string {
  const start = dayjs(firstAt)
  const end = dayjs(lastAt)
  if (start.isSame(end, 'day')) return `${start.format('HH:mm')} – ${end.format('HH:mm')}`
  return `${start.format('MM/DD HH:mm')} – ${end.format('MM/DD HH:mm')}`
}

function parseSseSessionId(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data)
    if (parsed !== null && typeof parsed === 'object') {
      const id = Reflect.get(parsed, 'sessionId')
      if (typeof id === 'string') return id
    }
  } catch {}
  return null
}

export function SessionDetailPage() {
  const { t } = useTranslation()
  const { sessionId = '' } = useParams()
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [logs, setLogs] = useState<RequestLogItem[]>([])
  const [messages, setMessages] = useState<SessionMessageItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    Promise.all([
      api.getSessionSummary(sessionId),
      api.getSessionLogs(sessionId),
      api.getSessionMessages(sessionId, { limit: MESSAGE_PAGE_SIZE })
    ])
      .then(([summaryRes, logsRes, msgsRes]) => {
        if (cancelled) return
        setSummary(summaryRes)
        setLogs(logsRes.items)
        setMessages(msgsRes.items)
        setNextCursor(msgsRes.nextCursor)
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // SSE: when a new RequestLog lands on this session, silently refresh the
  // stats and append any new archived turns — without disturbing the pages
  // of older messages already loaded.
  useEffect(() => {
    const apiKey = localStorage.getItem('apiKey') ?? ''
    if (!apiKey) return
    const es = new EventSource(`/api/request-logs/events?apikey=${encodeURIComponent(apiKey)}`)
    es.onmessage = (e) => {
      if (parseSseSessionId(e.data) !== sessionId) return
      void api.getSessionSummary(sessionId).then(setSummary)
      void api.getSessionLogs(sessionId).then((res) => setLogs(res.items))
      void api.getSessionMessages(sessionId, { limit: MESSAGE_PAGE_SIZE }).then((res) => {
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id))
          const appended = res.items.filter((m) => !known.has(m.id))
          return appended.length > 0 ? [...prev, ...appended] : prev
        })
      })
    }
    // Do not close on error: the browser's EventSource reconnects
    // automatically after transient network failures.
    return () => es.close()
  }, [sessionId])

  const loadOlder = useCallback(async () => {
    if (nextCursor === null) return
    const res = await api.getSessionMessages(sessionId, { before: nextCursor, limit: MESSAGE_PAGE_SIZE })
    setMessages((prev) => [...res.items, ...prev])
    setNextCursor(res.nextCursor)
  }, [sessionId, nextCursor])

  const backButton = (
    <Button asChild variant='ghost' size='icon' aria-label={t('sessions.detail.back')}>
      <Link to='/sessions'>
        <ArrowLeft className='h-4 w-4' />
      </Link>
    </Button>
  )

  if (notFound) {
    return (
      <PageContainer>
        <PageHeader fluid leading={backButton} title={t('sessions.title')} />
        <PageContent fluid className='items-center justify-center'>
          <div className='flex flex-col items-center gap-3 text-muted-foreground'>
            <MessagesSquare className='h-10 w-10 text-muted-foreground/30' />
            <p className='text-sm'>{t('sessions.detail.not_found')}</p>
            <Button asChild variant='outline' size='sm'>
              <Link to='/sessions'>{t('sessions.detail.back')}</Link>
            </Button>
          </div>
        </PageContent>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        fluid
        leading={backButton}
        title={summary ? dayjs(summary.lastAt).format('YYYY/MM/DD HH:mm') : t('sessions.title')}
      />
      <PageContent fluid>
        {loading && summary === null ? (
          <div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
            {t('sessions.loading')}
          </div>
        ) : (
          summary && (
            <div className='space-y-6'>
              <SessionHeader summary={summary} />
              <RequestLogSection logs={logs} />
              <ConversationSection
                hasOlder={nextCursor !== null}
                loading={loading}
                logs={logs}
                messages={messages}
                onLoadOlder={loadOlder}
              />
            </div>
          )
        )}
      </PageContent>
    </PageContainer>
  )
}

function SessionHeader({ summary }: { summary: SessionSummary }) {
  const { t } = useTranslation()

  const overviewTiles = [
    {
      label: t('sessions.detail.time'),
      value: fmtSessionRange(summary.firstAt, summary.lastAt),
      valueClassName: 'text-base whitespace-nowrap'
    },
    { label: t('sessions.detail.duration'), value: fmtMs(summary.totalDurationMs) },
    { label: t('sessions.detail.requests'), value: String(summary.requestCount) },
    { label: t('sessions.detail.cache_hit_rate'), value: <CacheBar pct={summary.avgCacheHitPct} /> }
  ]

  const tokenTiles = [
    { label: t('sessions.detail.input_tokens'), value: fmtTokens(summary.totalInputTokens) },
    { label: t('sessions.detail.output_tokens'), value: fmtTokens(summary.totalOutputTokens) },
    { label: t('sessions.detail.cache_read'), value: fmtTokens(summary.totalCacheReadTokens) },
    { label: t('sessions.detail.cache_write'), value: fmtTokens(summary.totalCacheWriteTokens) }
  ]

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <p className='min-w-0 truncate font-mono text-xs text-muted-foreground'>{summary.sessionId}</p>
        <div className='text-right'>
          {summary.totalCostUsd != null && (
            <p className='text-2xl font-bold text-foreground tabular-nums'>{fmtCost(summary.totalCostUsd)}</p>
          )}
          <p className='text-xs text-muted-foreground'>{t('sessions.detail.estimated_cost')}</p>
        </div>
      </div>

      <div className='grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3'>
        {overviewTiles.map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={tile.value} valueClassName={tile.valueClassName} />
        ))}
      </div>

      <section className='space-y-3'>
        <h3 className='border-b pb-2 text-base font-semibold text-foreground'>{t('sessions.detail.tokens')}</h3>
        <div className='grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3'>
          {tokenTiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} valueClassName='font-mono text-lg' />
          ))}
        </div>
      </section>
    </div>
  )
}

// Per-request breakdown of the session: every upstream call with its routed
// model, scenario lane, token counts, cache hit, latency, status, and cost.
function RequestLogSection({ logs }: { logs: RequestLogItem[] }) {
  const { t } = useTranslation()

  const modelBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { requests: number; inputTokens: number; outputTokens: number; cost: number | null; cacheHitPctSum: number }
    >()
    for (const log of logs) {
      const prev = map.get(log.model) ?? { cacheHitPctSum: 0, cost: null, inputTokens: 0, outputTokens: 0, requests: 0 }
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

  if (logs.length === 0) return null

  return (
    <div className='space-y-6'>
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

      <section className='space-y-3'>
        <h3 className='border-b pb-2 text-base font-semibold text-foreground'>{t('sessions.detail.requests')}</h3>
        <div className='overflow-x-auto'>
          <div className='min-w-[40rem] divide-y'>
            {logs.map((log) => (
              <div
                key={log.id}
                className='flex items-center gap-3 border-l-2 border-transparent py-2 pl-2 text-xs transition-colors hover:border-primary hover:bg-muted/50'
              >
                <span className='w-16 shrink-0 font-mono text-muted-foreground tabular-nums'>
                  {dayjs(log.createdAt).format('HH:mm:ss')}
                </span>
                <span className='min-w-0 flex-1 truncate font-mono text-foreground'>{log.model}</span>
                {log.scenario !== null && (
                  <span className='shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'>
                    {log.scenario}
                  </span>
                )}
                <span className='w-24 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums'>
                  {fmtTokens(log.totalInputTokens)}↑ {fmtTokens(log.outputTokens)}↓
                </span>
                <span className='w-10 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums'>
                  {log.cacheHitPct}%
                </span>
                <span className='w-14 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums'>
                  {fmtMs(log.durationMs)}
                </span>
                <span
                  className={`w-10 shrink-0 whitespace-nowrap text-right font-mono tabular-nums ${
                    log.status >= 400 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {log.status}
                </span>
                <span className='w-20 shrink-0 whitespace-nowrap text-right font-mono text-foreground tabular-nums'>
                  {fmtCost(log.totalCostUsd)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Conversation view ────────────────────────────────────────────────────────
// Chat-style rendering of the archived user + assistant turns for a session.
// Content shapes:
//   - string                → rendered verbatim as one text line
//   - Anthropic block array → per-block bubble (text / tool_use / tool_result)
//   - anything else         → JSON-serialised fallback so debugging isn't blind

function ConversationSection({
  messages,
  logs,
  loading,
  hasOlder,
  onLoadOlder
}: {
  messages: SessionMessageItem[]
  logs: RequestLogItem[]
  loading: boolean
  hasOlder: boolean
  onLoadOlder: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [showDeveloper, setShowDeveloper] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  // Pair each assistant turn with its request log. There is no shared id
  // between the Message and RequestLog tables, but both are written once
  // per successful request, so zipping the two createdAt-ordered sequences
  // lines them up 1:1. Older message pages may not be loaded yet, so the
  // zip is anchored at the NEWEST end (both walked descending) — the tail
  // alignment stays stable no matter how much history has been paged in.
  const logByMessageId = useMemo(() => {
    const logsDesc = [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const map = new Map<string, RequestLogItem>()
    let i = 0
    for (let m = messages.length - 1; m >= 0; m--) {
      const message = messages[m]
      if (message.role !== 'assistant') continue
      const log = logsDesc[i]
      if (log) map.set(message.id, log)
      i += 1
    }
    return map
  }, [messages, logs])

  // Normalise once so the toggle only re-filters, never re-parses. Rows
  // whose visible-in-current-mode block list is empty are dropped entirely
  // so a tool-only turn doesn't leave an empty bubble behind.
  const normalised = useMemo(
    () =>
      messages.map((m) => ({ blocks: normaliseContent(m.content), createdAt: m.createdAt, id: m.id, role: m.role })),
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

  // Chat-app scrolling: pin the view to the newest turn at the bottom when
  // the session's messages load or new turns arrive. When older history is
  // prepended, keep the viewport anchored on the turn the reader was at by
  // restoring the scroll offset relative to the grown content height.
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependHeightRef = useRef<number | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin only when the message set changes, not on developer-toggle re-renders
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependHeightRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
      return
    }
    el.scrollTop = el.scrollHeight
  }, [messages])

  const handleLoadOlder = async () => {
    const el = scrollRef.current
    if (el) prependHeightRef.current = el.scrollHeight - el.scrollTop
    setLoadingOlder(true)
    try {
      await onLoadOlder()
    } finally {
      setLoadingOlder(false)
    }
  }

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
      ) : displayed.length === 0 && !hasOlder ? (
        <p className='text-sm text-muted-foreground'>{t('sessions.detail.conversation_empty')}</p>
      ) : (
        <div ref={scrollRef} className='max-h-[70vh] space-y-2 overflow-y-auto pr-1'>
          {hasOlder && (
            <div className='flex justify-center pb-2'>
              <Button
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                disabled={loadingOlder}
                onClick={handleLoadOlder}
              >
                {loadingOlder ? t('sessions.loading') : t('sessions.detail.load_older')}
              </Button>
            </div>
          )}
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
        {blocks.map((b, position) => (
          <MessageBlock key={blockKey(id, position, b)} block={b} />
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
