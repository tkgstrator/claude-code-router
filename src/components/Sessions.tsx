import { ChevronDown, ChevronRight, Clock, Layers, MessagesSquare, RefreshCw, Trash2, Wrench, Zap } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { api, type RequestLogItem, type SessionMessageItem, type SessionSummary } from '@/lib/api'
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

export function SessionsPage() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  const [detailRefresh, setDetailRefresh] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getRequestLogSessions({ limit: 100, sinceHours: 6 })
      setSessions(res.sessions)
      setTotal(res.total)
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
            if (idx === -1) {
              setTotal((t) => t + 1)
              return [summary, ...prev]
            }
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

  const handleClearAll = async () => {
    if (!window.confirm(t('sessions.clear_confirm'))) return
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
            <MessagesSquare className='h-4 w-4' />
            <span className='font-semibold text-sm'>{t('sessions.title')}</span>
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
              {t('sessions.loading')}
            </div>
          ) : sessions.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-48 text-muted-foreground gap-2'>
              <MessagesSquare className='h-10 w-10 text-muted-foreground/30' />
              <p className='text-sm'>{t('sessions.no_history')}</p>
            </div>
          ) : (
            <ul>
              {sessions.map((session) => {
                const isActive = selected?.sessionId === session.sessionId
                const hasPreview = session.preview !== null && session.preview.length > 0
                return (
                  <li
                    key={session.sessionId}
                    className={`group relative px-4 py-2.5 cursor-pointer border-b transition-colors ${
                      isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    }`}
                    onClick={() => setSelected(session)}
                  >
                    <div className='flex items-start justify-between gap-1'>
                      <div className='min-w-0 flex-1 space-y-1'>
                        <p
                          className={`text-sm leading-snug line-clamp-2 ${
                            hasPreview ? 'text-foreground' : 'italic text-muted-foreground'
                          }`}
                        >
                          {hasPreview ? session.preview : t('sessions.preview_empty')}
                        </p>
                        <p className='flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums'>
                          <span>{dayjs(session.lastAt).format('MM/DD HH:mm')}</span>
                          <span className='opacity-40'>·</span>
                          <span className='flex items-center gap-0.5'>
                            <Layers className='h-3 w-3' />
                            {session.requestCount}
                          </span>
                          <span>{fmtTokens(session.totalInputTokens + session.totalOutputTokens)} tok</span>
                          {session.totalCostUsd != null && <span>{fmtCost(session.totalCostUsd)}</span>}
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
            <p className='text-sm'>{t('sessions.select_session')}</p>
          </div>
        ) : (
          <SessionDetail session={selected} refreshTrigger={detailRefresh} />
        )}
      </main>
    </div>
  )
}

function SessionDetail({ session, refreshTrigger }: { session: SessionSummary; refreshTrigger?: number }) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<RequestLogItem[]>([])
  const [messages, setMessages] = useState<SessionMessageItem[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

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
      setExpanded(null)
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

  const summaryRows = [
    {
      label: t('sessions.detail.time'),
      value: `${dayjs(session.firstAt).format('YYYY/MM/DD HH:mm')} – ${dayjs(session.lastAt).format('HH:mm')}`
    },
    { label: t('sessions.detail.duration'), value: fmtMs(session.totalDurationMs) },
    { label: t('sessions.detail.requests'), value: String(session.requestCount) }
  ]

  const tokenRows = [
    { label: t('sessions.detail.input_tokens'), value: fmtTokens(session.totalInputTokens) },
    { label: t('sessions.detail.output_tokens'), value: fmtTokens(session.totalOutputTokens) },
    { label: t('sessions.detail.cache_read'), value: fmtTokens(session.totalCacheReadTokens) },
    { label: t('sessions.detail.cache_write'), value: fmtTokens(session.totalCacheWriteTokens) }
  ]

  return (
    <div className='max-w-2xl mx-auto space-y-6'>
      {/* Header */}
      <div className='flex items-start justify-between'>
        <div>
          <p className='text-xs text-muted-foreground font-mono truncate max-w-xs'>{session.sessionId}</p>
          <h2 className='text-xl font-semibold text-foreground'>{dayjs(session.lastAt).format('YYYY/MM/DD HH:mm')}</h2>
        </div>
        <div className='text-right'>
          {session.totalCostUsd != null && (
            <p className='text-2xl font-bold text-foreground'>{fmtCost(session.totalCostUsd)}</p>
          )}
          <p className='text-xs text-muted-foreground'>{t('sessions.detail.estimated_cost')}</p>
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
        <h3 className='text-base font-semibold text-foreground mb-2'>{t('sessions.detail.tokens')}</h3>
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
        <h3 className='text-base font-semibold text-foreground mb-2'>{t('sessions.detail.cache')}</h3>
        <div className='bg-muted rounded-lg px-4 py-3 flex items-center gap-4'>
          <CacheBar pct={session.avgCacheHitPct} />
          <span className='text-sm text-muted-foreground'>{t('sessions.detail.cache_hit_rate')}</span>
        </div>
      </div>

      {/* Conversation */}
      <ConversationSection messages={messages} />

      {/* Per-model breakdown */}
      {modelBreakdown.length > 0 && (
        <div>
          <h3 className='text-base font-semibold text-foreground mb-2'>{t('sessions.detail.model_breakdown')}</h3>
          <div className='bg-muted rounded-lg divide-y'>
            {modelBreakdown.map((entry) => (
              <div key={entry.model} className='flex items-center gap-2 px-4 py-2 text-[11px]'>
                <span className='font-mono text-foreground flex-1 min-w-0 truncate'>{entry.model}</span>
                <span className='text-muted-foreground tabular-nums w-14 text-right shrink-0 whitespace-nowrap'>
                  {entry.requests} req
                </span>
                <span className='text-muted-foreground tabular-nums w-14 text-right shrink-0 whitespace-nowrap'>
                  {fmtTokens(entry.inputTokens)}↑
                </span>
                <span className='text-muted-foreground tabular-nums w-12 text-right shrink-0 whitespace-nowrap'>
                  {fmtTokens(entry.outputTokens)}↓
                </span>
                <span className='text-muted-foreground tabular-nums w-9 text-right shrink-0 whitespace-nowrap'>
                  {entry.avgCacheHitPct}%
                </span>
                <span className='font-mono text-foreground tabular-nums w-18 text-right shrink-0 whitespace-nowrap'>
                  {fmtCost(entry.cost)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Individual requests */}
      <div>
        <h3 className='text-base font-semibold text-foreground mb-2'>{t('sessions.detail.requests_list')}</h3>
        {loadingLogs ? (
          <p className='text-sm text-muted-foreground'>{t('sessions.loading')}</p>
        ) : (
          <div className='space-y-1'>
            {logs.map((log) => (
              <div key={log.id} className='border rounded-lg overflow-hidden'>
                <button
                  type='button'
                  className='w-full flex items-center gap-2 px-4 py-2.5 text-[11px] hover:bg-muted transition-colors'
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <Clock className='h-3 w-3 text-muted-foreground shrink-0' />
                  <span className='tabular-nums text-muted-foreground w-14 shrink-0 whitespace-nowrap'>
                    {dayjs(log.createdAt).format('HH:mm:ss')}
                  </span>
                  <span className='font-mono text-foreground flex-1 min-w-0 truncate text-left'>{log.model}</span>
                  <span className='text-muted-foreground tabular-nums w-14 text-right shrink-0 whitespace-nowrap'>
                    {fmtTokens(log.totalInputTokens)}↑
                  </span>
                  <span className='text-muted-foreground tabular-nums w-12 text-right shrink-0 whitespace-nowrap'>
                    {fmtTokens(log.outputTokens)}↓
                  </span>
                  <span className='text-muted-foreground tabular-nums w-9 text-right shrink-0 whitespace-nowrap'>
                    {log.cacheHitPct}%
                  </span>
                  <span className='font-mono text-foreground tabular-nums w-18 text-right shrink-0 whitespace-nowrap'>
                    {fmtCost(log.totalCostUsd)}
                  </span>
                  <StatusBadge status={log.status} />
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0 ${expanded === log.id ? 'rotate-90' : ''}`}
                  />
                </button>
                {expanded === log.id && (
                  <div className='border-t bg-muted px-4 py-3 grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs'>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>{t('sessions.detail.input_tokens')}</span>
                      <span className='font-mono'>{fmtTokens(log.inputTokens)}</span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>{t('sessions.detail.output_tokens')}</span>
                      <span className='font-mono'>{fmtTokens(log.outputTokens)}</span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>{t('sessions.detail.cache_read')}</span>
                      <span className='font-mono'>{fmtTokens(log.cacheReadTokens)}</span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>{t('sessions.detail.cache_write')}</span>
                      <span className='font-mono'>{fmtTokens(log.cacheWriteTokens)}</span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>{t('sessions.detail.duration')}</span>
                      <span className='font-mono'>{fmtMs(log.durationMs)}</span>
                    </div>
                    {log.totalCostUsd != null && (
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('sessions.detail.estimated_cost')}</span>
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
    </div>
  )
}

// ── Conversation view ────────────────────────────────────────────────────────
// Chat-style rendering of the archived user + assistant turns for a session.
// Content shapes:
//   - string                              → rendered verbatim as one text line
//   - Anthropic block array               → per-block bubble (text / tool_use / tool_result)
//   - anything else                       → JSON-serialised fallback so debugging isn't blind

function ConversationSection({ messages }: { messages: SessionMessageItem[] }) {
  const { t } = useTranslation()
  const [showDeveloper, setShowDeveloper] = useState(false)

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

  return (
    <div>
      <div className='flex items-center justify-between mb-2'>
        <h3 className='text-base font-semibold text-foreground'>{t('sessions.detail.conversation')}</h3>
        {hasDeveloperContent && (
          <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={() => setShowDeveloper((v) => !v)}>
            {showDeveloper ? t('sessions.detail.hide_developer') : t('sessions.detail.show_developer')}
          </Button>
        )}
      </div>
      {displayed.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t('sessions.detail.conversation_empty')}</p>
      ) : (
        <div className='space-y-2'>
          {displayed.map((m) => (
            <MessageBubble key={m.id} id={m.id} role={m.role} createdAt={m.createdAt} blocks={m.blocks} />
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  id,
  role,
  createdAt,
  blocks
}: {
  id: string
  role: SessionMessageItem['role']
  createdAt: string
  blocks: NormalisedBlock[]
}) {
  const isUser = role === 'user'
  const alignment = isUser ? 'items-end' : 'items-start'
  const bubble = isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
  return (
    <div className={`flex flex-col ${alignment} gap-1`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm space-y-1.5 ${bubble}`}>
        {blocks.map((b) => (
          <MessageBlock key={blockKey(id, b)} block={b} />
        ))}
      </div>
      <span className='text-[10px] text-muted-foreground tabular-nums'>{dayjs(createdAt).format('HH:mm:ss')}</span>
    </div>
  )
}

type NormalisedBlock =
  | { kind: 'text'; text: string }
  | { kind: 'system_text'; text: string; preview: string }
  | { kind: 'tool_use'; name: string; input: string; truncated: boolean }
  | { kind: 'tool_result'; text: string }
  | { kind: 'raw'; text: string }

// Coerce the on-wire content into a flat list of blocks the renderer knows
// how to draw. Never throws — an unrecognised shape falls back to a raw
// JSON block so nothing is silently swallowed.
function normaliseContent(content: unknown): NormalisedBlock[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }]
  if (!Array.isArray(content)) return [{ kind: 'raw', text: safeJson(content) }]
  return content.map(normaliseBlock)
}

// Stable per-block React key. Blocks never shuffle within a message once
// the row is persisted, but the noArrayIndexKey rule wants a content-derived
// key; kind + a short content prefix collides only if two identical text /
// tool_use blocks appear in the same message, which is fine for React's
// reconciliation.
function blockKey(messageId: string, block: NormalisedBlock): string {
  if (block.kind === 'text') return `${messageId}:t:${block.text.slice(0, 32)}`
  if (block.kind === 'system_text') return `${messageId}:s:${block.text.slice(0, 32)}`
  if (block.kind === 'tool_use') return `${messageId}:u:${block.name}:${block.input.slice(0, 32)}`
  if (block.kind === 'tool_result') return `${messageId}:r:${block.text.slice(0, 32)}`
  return `${messageId}:x:${block.text.slice(0, 32)}`
}

function normaliseBlock(raw: unknown): NormalisedBlock {
  if (raw === null || typeof raw !== 'object') return { kind: 'raw', text: String(raw) }
  const type = Reflect.get(raw, 'type')
  if (type === 'text') return classifyTextBlock(readString(raw, 'text', ''))
  if (type === 'tool_use') return normaliseToolUse(raw)
  if (type === 'tool_result') return { kind: 'tool_result', text: flattenToolResult(Reflect.get(raw, 'content')) }
  return { kind: 'raw', text: safeJson(raw) }
}

// Text blocks in CCR sessions are a mix of natural chat and framework-injected
// noise: <system-reminder> / <transcript> / <command-*> wrappers, proxied tool
// traffic serialised as {"Agent": …} / {"Bash": …} / {"user": …}, and bracketed
// mode instructions like [SUGGESTION MODE …]. The classifier collapses all
// three shapes behind a preview so real conversation stays foreground.
function classifyTextBlock(text: string): NormalisedBlock {
  const trimmed = text.trimStart()
  const head = trimmed.charAt(0)
  const isXmlish = head === '<' && /^<[a-zA-Z/!?][^>]{0,120}>/.test(trimmed)
  const isJsonish = (head === '{' || head === '[') && looksLikeJson(trimmed)
  const isBracketMode = head === '[' && /^\[[A-Z][A-Z_ -]{2,60}[\]:]/.test(trimmed)
  if (isXmlish || isJsonish || isBracketMode) {
    return { kind: 'system_text', text, preview: makePreview(trimmed) }
  }
  return { kind: 'text', text }
}

function looksLikeJson(s: string): boolean {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

function makePreview(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine
}

function normaliseToolUse(raw: object): NormalisedBlock {
  const input = Reflect.get(raw, 'input')
  return {
    kind: 'tool_use',
    name: readString(raw, 'name', 'tool'),
    input: typeof input === 'string' ? input : safeJson(input),
    truncated: Reflect.get(raw, 'input_truncated') === true
  }
}

function readString(source: object, key: string, fallback: string): string {
  const value = Reflect.get(source, key)
  return typeof value === 'string' ? value : fallback
}

// tool_result.content is either a string or a block array of text blocks;
// flatten both into a single string for the chat view.
function flattenToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return safeJson(content)
  return content.map(flattenToolResultBlock).join('\n')
}

function flattenToolResultBlock(block: unknown): string {
  if (block === null || typeof block !== 'object') return String(block)
  if (Reflect.get(block, 'type') === 'text') return readString(block, 'text', '')
  return safeJson(block)
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2)
    return typeof s === 'string' ? s : String(value)
  } catch {
    return String(value)
  }
}

function MessageBlock({ block }: { block: NormalisedBlock }) {
  const { t } = useTranslation()
  if (block.kind === 'text') {
    return <div className='whitespace-pre-wrap break-words'>{block.text}</div>
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

function fmtChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M chars`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k chars`
  return `${n} chars`
}
