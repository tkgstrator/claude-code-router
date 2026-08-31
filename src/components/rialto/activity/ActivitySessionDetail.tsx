/**
 * Activity › Session — one conversation, with the routing trace beside it.
 *
 * The trace is the part the old build could not answer: "why did this turn
 * go to that model" was written to the request log but only readable by
 * grepping. Requested → sent, per call, next to the turn it served.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { type ActivityRequestLog, downloadText, fetchSessionRequestLogs } from '@/components/rialto/activity/data'
import { DASH, ScreenMessage, StatusPill } from '@/components/rialto/activity/shared'
import { useSurfaces } from '@/components/rialto/activity/use-surfaces'
import { Meter, Pill, RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { api, type SessionMessageItem, type SessionSummary } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { fmtAgo, fmtRate } from '@/lib/rialto/format'
import { fmtChars, fmtCost } from '@/lib/sessions/format'
import { normaliseContent } from '@/lib/sessions/message-content'
import { cn } from '@/lib/utils'

const MESSAGE_PAGE_SIZE = 50

// How much of the trace opens by default. A long session has hundreds of
// calls and the rail is 22rem wide.
const TRACE_PREVIEW = 5

interface Turn {
  id: string
  role: string
  text: string
  tools: string[]
  chars: number
}

/**
 * Fold one archived message into a rendered turn.
 *
 * `system_text` blocks are Claude Code's injected reminders and file dumps;
 * they are the bulk of a real transcript by volume and none of it by
 * meaning, so they never reach the pane.
 */
function toTurn(message: SessionMessageItem): Turn {
  const blocks = normaliseContent(message.content)
  const text = blocks
    .filter((b) => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n')
  const counts = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind === 'tool_use') {
      const seen = counts.get(block.name)
      counts.set(block.name, seen === undefined ? 1 : seen + 1)
    }
  }
  return {
    id: message.id,
    role: message.role,
    text,
    tools: [...counts.entries()].map(([name, n]) => (n === 1 ? name : `${name} × ${n}`)),
    chars: text.length
  }
}

function TurnRow({ turn }: { turn: Turn }) {
  const isUser = turn.role === 'user'
  return (
    <div
      className={cn(
        'border-l-2 px-6 py-4 transition-colors hover:bg-muted/50',
        isUser ? 'border-l-foreground/30' : 'border-l-transparent'
      )}
    >
      <div className='flex items-baseline gap-2'>
        <span
          className={cn(
            'text-[11px] font-medium uppercase tracking-wider',
            isUser ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {turn.role}
        </span>
        {turn.tools.map((tool) => (
          <Pill key={tool} tone='mute'>
            {tool}
          </Pill>
        ))}
        <span className='ml-auto font-mono text-[11px] tabular-nums text-muted-foreground'>{fmtChars(turn.chars)}</span>
      </div>
      {turn.text === '' ? null : <p className='mt-1.5 whitespace-pre-wrap text-xs leading-relaxed'>{turn.text}</p>}
    </div>
  )
}

function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='flex items-baseline gap-3 px-4 py-1.5'>
      <span className='text-[11px] text-muted-foreground'>{label}</span>
      <span className='ml-auto font-mono text-[11px] tabular-nums'>{value}</span>
    </div>
  )
}

function CallRow({ call }: { call: ActivityRequestLog }) {
  const lane = call.isSubagent === null ? 'untracked' : call.isSubagent ? 'subagent' : 'agent'
  const requested = call.requestedModel === null ? 'untracked' : call.requestedModel
  return (
    <div className='border-t border-border/60 px-4 py-2.5 transition-colors hover:bg-muted/50'>
      <div className='flex items-baseline gap-2'>
        <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>
          {dayjs(call.createdAt).format('HH:mm:ss')}
        </span>
        <StatusPill status={call.status} />
        <span className='ml-auto font-mono text-[11px] tabular-nums text-muted-foreground'>
          {call.durationMs === 0 ? DASH : call.durationMs.toLocaleString()} ms
        </span>
      </div>
      <div className='mt-1.5 flex items-center gap-1.5 font-mono text-[11px]'>
        <span className='text-muted-foreground'>{requested}</span>
        <i className='ri-arrow-right-line text-xs text-muted-foreground/50' />
        <span>{`${call.provider},${call.model}`}</span>
      </div>
      <div className='mt-1 flex gap-1.5'>
        <Pill tone='mute'>{call.scenario === null ? 'untracked' : call.scenario}</Pill>
        <Pill tone='mute'>{lane}</Pill>
      </div>
    </div>
  )
}

function SummaryPane({
  summary,
  turns,
  inboundPath
}: {
  summary: SessionSummary
  turns: number
  inboundPath: string | null
}) {
  const totalInput = summary.totalInputTokens
  const cacheRate = totalInput === 0 ? null : summary.totalCacheReadTokens / totalInput
  const cachePct = cacheRate === null ? 0 : Math.round(cacheRate * 100)
  return (
    <>
      <div className='px-4 pt-5 pb-2'>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Summary</h2>
      </div>
      <Kv label='Inbound' value={inboundPath === null ? 'untracked' : inboundPath} />
      <Kv label='Turns' value={turns} />
      <Kv label='Upstream calls' value={summary.requestCount} />
      <Kv label='Input tokens' value={summary.totalInputTokens.toLocaleString()} />
      <Kv label='Output tokens' value={summary.totalOutputTokens.toLocaleString()} />
      <Kv label='Cache read' value={summary.totalCacheReadTokens.toLocaleString()} />
      <Kv label='Cache hit' value={fmtRate(cacheRate)} />
      <Kv label='Cost' value={fmtCost(summary.totalCostUsd)} />
      <Kv label='Duration' value={fmtAgo(summary.firstAt, Date.parse(summary.lastAt))} />

      <div className='px-4 pb-3 pt-3'>
        <div className='mb-1.5 flex items-baseline'>
          <span className='text-[11px] text-muted-foreground'>Cache efficiency</span>
          <span className='ml-auto font-mono text-[11px] tabular-nums'>{cachePct}%</span>
        </div>
        {/* Explicit `ok`: a high cache hit is the good end of the scale, the
            inverse of the utilization meters the auto tone is built for. */}
        <Meter pct={cachePct} tone='ok' />
      </div>
    </>
  )
}

function TracePane({ calls }: { calls: ActivityRequestLog[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? calls : calls.slice(-TRACE_PREVIEW)
  return (
    <>
      <div className='border-t border-border px-4 pt-5 pb-2'>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Routing trace</h2>
      </div>
      {shown.map((call) => (
        <CallRow key={call.id} call={call} />
      ))}
      {calls.length <= TRACE_PREVIEW ? null : (
        <div className='px-4 py-4'>
          <button
            type='button'
            onClick={() => setExpanded((v) => !v)}
            className='w-full rounded-md border border-dashed border-border py-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50'
          >
            {expanded ? 'Show fewer' : `Show all ${calls.length} calls`}
          </button>
        </div>
      )}
    </>
  )
}

interface Loaded {
  summary: SessionSummary
  messages: SessionMessageItem[]
  nextCursor: string | null
  calls: ActivityRequestLog[]
}

export function ActivitySessionDetail() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [neighbours, setNeighbours] = useState<string[]>([])
  const surfaces = useSurfaces()

  useEffect(() => {
    setData(null)
    Promise.all([
      api.getSessionSummary(sessionId),
      api.getSessionMessages(sessionId, { limit: MESSAGE_PAGE_SIZE }),
      fetchSessionRequestLogs(sessionId)
    ])
      .then(([summary, messages, logs]) => {
        // Logs arrive newest-first; the trace reads as a story forwards.
        setData({
          summary,
          messages: messages.items,
          nextCursor: messages.nextCursor,
          calls: [...logs.items].reverse()
        })
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [sessionId])

  // Previous / Next walk the same list the Activity table shows, so the
  // header arrows move through what the operator was just looking at.
  useEffect(() => {
    api
      .getRequestLogSessions({ limit: 100, sinceHours: 168 })
      .then((res) => setNeighbours(res.sessions.map((s) => s.sessionId)))
      .catch(() => {
        // Navigation affordance only.
      })
  }, [])

  const turns = useMemo(() => (data === null ? [] : data.messages.map(toTurn)), [data])

  const inboundPath = data === null ? null : surfaces.pathOf(data.summary.surface)

  const index = neighbours.indexOf(sessionId)
  const prev = index > 0 ? neighbours[index - 1] : null
  const next = index >= 0 && index < neighbours.length - 1 ? neighbours[index + 1] : null

  const loadOlder = () => {
    if (data === null || data.nextCursor === null) return
    void api
      .getSessionMessages(sessionId, { before: data.nextCursor, limit: MESSAGE_PAGE_SIZE })
      .then((res) =>
        setData((prevData) =>
          prevData === null
            ? prevData
            : { ...prevData, messages: [...res.items, ...prevData.messages], nextCursor: res.nextCursor }
        )
      )
  }

  const downloadRaw = () => {
    if (data === null) return
    downloadText(`${sessionId}.json`, JSON.stringify(data, null, 2), 'application/json')
  }

  const title = data === null ? sessionId : preferredTitle(data.summary, sessionId)
  const subtitle =
    data === null
      ? undefined
      : `${sessionId} · ${inboundPath === null ? 'untracked' : inboundPath} · ${turns.length} turns`

  return (
    <Screen
      title='Session'
      subtitle={subtitle}
      actions={
        <>
          <RButton
            variant='ghost'
            icon='ri-arrow-up-s-line'
            disabled={prev === null}
            onClick={() => prev !== null && navigate(`/activity/sessions/${encodeURIComponent(prev)}`)}
          >
            Previous
          </RButton>
          <RButton
            variant='ghost'
            icon='ri-arrow-down-s-line'
            disabled={next === null}
            onClick={() => next !== null && navigate(`/activity/sessions/${encodeURIComponent(next)}`)}
          >
            Next
          </RButton>
        </>
      }
    >
      {error !== null ? (
        <ScreenMessage tone='bad'>{error}</ScreenMessage>
      ) : data === null ? (
        <ScreenMessage>Loading…</ScreenMessage>
      ) : (
        <div className='grid h-full grid-cols-[1fr_22rem]'>
          <div className='min-w-0 overflow-y-auto border-r border-border'>
            <div className='flex items-center gap-2 border-b border-border px-6 py-3'>
              <Link
                to='/activity'
                className='text-muted-foreground hover:text-foreground'
                aria-label='Back to Activity'
              >
                <i className='ri-arrow-left-line text-base' />
              </Link>
              <div className='min-w-0'>
                <div className='truncate text-xs font-medium'>{title}</div>
                <div className='font-mono text-[11px] text-muted-foreground'>{sessionId}</div>
              </div>
              <div className='ml-auto flex gap-2'>
                <RButton variant='ghost' icon='ri-code-line' onClick={downloadRaw}>
                  Raw JSON
                </RButton>
                <RButton
                  variant='ghost'
                  icon='ri-archive-line'
                  disabled
                  title='Archiving one session has no endpoint yet — Activity archives all active sessions.'
                >
                  Archive
                </RButton>
              </div>
            </div>
            {data.nextCursor === null ? null : (
              <div className='px-6 pt-4'>
                <button
                  type='button'
                  onClick={loadOlder}
                  className='w-full rounded-md border border-dashed border-border py-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50'
                >
                  Load older turns
                </button>
              </div>
            )}
            {turns.map((turn) => (
              <TurnRow key={turn.id} turn={turn} />
            ))}
            <div className='h-10' />
          </div>

          <aside className='min-w-0 overflow-y-auto'>
            <SummaryPane summary={data.summary} turns={turns.length} inboundPath={inboundPath} />
            <TracePane calls={data.calls} />
          </aside>
        </div>
      )}
    </Screen>
  )
}

function preferredTitle(summary: SessionSummary, sessionId: string): string {
  const preview = summary.preview
  return preview === null || preview === '' ? sessionId : preview
}
