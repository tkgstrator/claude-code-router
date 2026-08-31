/**
 * Overview — the one-page answer to "is Rialto doing what I set it up to
 * do right now".
 *
 * The headline is the four inbound surfaces, because that is Rialto's
 * identity (four wire formats in, many vendors out) and because the old
 * build gave the operator no way to see that only one of them was
 * actually routed.
 */
import { useCallback, useEffect, useState } from 'react'
import { Meter, Mono, Pill, RButton, Section, SurfacePill } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { api, type OverviewResponse, type OverviewSpendRow } from '@/lib/api'
import { fmtAgo, fmtCount, fmtLatency, fmtRate, fmtUntil, shortId } from '@/lib/rialto/format'
import { fmtCost, fmtTokens } from '@/lib/sessions/format'

const SPEND_LABELS: Record<OverviewSpendRow['label'], string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  savedBySubscription: 'Saved by subscription'
}

function SurfaceTable({ data }: { data: OverviewResponse }) {
  return (
    <table className='w-full table-fixed'>
      <colgroup>
        <col />
        <col className='w-32' />
        <col className='w-28' />
        <col className='w-20' />
        <col className='w-24' />
      </colgroup>
      <thead>
        <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
          <th className='pb-2 pl-6 pr-3 text-left font-medium'>Surface</th>
          <th className='px-3 text-left font-medium'>Routing</th>
          <th className='px-3 text-right font-medium'>Requests</th>
          <th className='px-3 text-right font-medium'>p50</th>
          <th className='pb-2 pl-3 pr-6 text-right font-medium'>Errors</th>
        </tr>
      </thead>
      <tbody>
        {data.surfaces.map((s) => (
          <tr key={s.id} className='border-t border-border/60 transition-colors hover:bg-muted/50'>
            <td className='py-2.5 pl-6 pr-3'>
              <div className='font-mono text-xs'>{s.path}</div>
              <div className='text-[11px] text-muted-foreground'>{s.client}</div>
            </td>
            <td className='px-3'>
              {s.routingMode === 'routed' ? <Pill tone='ok'>routed</Pill> : <Pill tone='mute'>passthrough</Pill>}
            </td>
            <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtCount(s.requests)}</td>
            <td className='px-3 text-right font-mono text-xs tabular-nums text-muted-foreground'>
              {fmtLatency(s.p50Ms)}
            </td>
            <td className='py-2.5 pl-3 pr-6 text-right font-mono text-xs tabular-nums text-muted-foreground'>
              {fmtRate(s.errorRate)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SessionTable({ data, now }: { data: OverviewResponse; now: number }) {
  if (data.recentSessions.length === 0) {
    return <div className='px-6 pb-6 text-xs text-muted-foreground'>No sessions in this window.</div>
  }
  return (
    <table className='w-full table-fixed'>
      <colgroup>
        <col className='w-40' />
        <col className='w-40' />
        <col />
        <col className='w-16' />
        <col className='w-20' />
        <col className='w-24' />
        <col className='w-16' />
      </colgroup>
      <thead>
        <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
          <th className='pb-2 pl-6 pr-3 text-left font-medium'>Session</th>
          <th className='px-3 text-left font-medium'>Endpoint</th>
          <th className='px-3 text-left font-medium'>Model</th>
          <th className='px-3 text-right font-medium'>Turns</th>
          <th className='px-3 text-right font-medium'>Tokens</th>
          <th className='px-3 text-right font-medium'>Cost</th>
          <th className='pb-2 pl-3 pr-6 text-right font-medium'>Last</th>
        </tr>
      </thead>
      <tbody>
        {data.recentSessions.map((s) => {
          const path = data.surfaces.find((x) => x.id === s.surface)?.path
          return (
            <tr key={s.sessionId} className='border-t border-border/60 transition-colors hover:bg-muted/50'>
              <td className='py-2.5 pl-6 pr-3 font-mono text-xs'>{shortId(s.sessionId)}</td>
              <td className='px-3'>{path === undefined ? <Mono>untracked</Mono> : <SurfacePill path={path} />}</td>
              <td className='px-3 font-mono text-xs text-muted-foreground'>{s.model}</td>
              <td className='px-3 text-right font-mono text-xs tabular-nums'>{s.turns}</td>
              <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtTokens(s.tokens)}</td>
              <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtCost(s.costUsd)}</td>
              <td className='py-2.5 pl-3 pr-6 text-right text-[11px] text-muted-foreground'>{fmtAgo(s.lastAt, now)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function Overview() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Captured once per load so every relative label on the page is
  // measured from the same instant the data describes.
  const [now, setNow] = useState(Date.now())

  const load = useCallback(() => {
    setLoading(true)
    api
      .getOverview({ windowHours: 24 })
      .then((res) => {
        setData(res)
        setNow(Date.parse(res.generatedAt))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const subtitle =
    data === null
      ? undefined
      : `${data.surfaces.length} inbound surfaces · ${data.providerCount} providers · ${data.enabledModelCount} models enabled`

  return (
    <Screen
      title='Overview'
      subtitle={subtitle}
      actions={
        <>
          <RButton variant='outline' icon='ri-time-line'>
            Last 24h
          </RButton>
          <RButton variant='ghost' icon='ri-refresh-line' onClick={load} disabled={loading}>
            Refresh
          </RButton>
        </>
      }
    >
      {error !== null ? (
        <div className='px-6 py-6 text-xs text-destructive'>{error}</div>
      ) : data === null ? (
        <div className='px-6 py-6 text-xs text-muted-foreground'>Loading…</div>
      ) : (
        <>
          <Section title='Inbound surfaces' meta={`last ${data.windowHours}h`}>
            <SurfaceTable data={data} />
          </Section>

          <Section title='Spend'>
            <div className='grid grid-cols-4 gap-px px-6 pb-6'>
              {data.spend.map((s) => (
                <div
                  key={s.label}
                  className='border-l-2 border-l-border px-4 py-3 transition-colors hover:bg-muted/50 hover:border-l-foreground/30'
                >
                  <div className='text-[11px] uppercase tracking-wider text-muted-foreground'>
                    {SPEND_LABELS[s.label]}
                  </div>
                  <div className='mt-1 flex items-baseline gap-2'>
                    <span className='font-mono text-xl tabular-nums'>{fmtCost(s.usd)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <div className='grid grid-cols-2 border-t border-border'>
            <div className='border-r border-border'>
              <Section title='Subscription quota'>
                {data.quota.length === 0 ? (
                  <div className='px-6 pb-6 text-xs text-muted-foreground'>No subscription quota collected yet.</div>
                ) : (
                  data.quota.map((q) => (
                    <div
                      key={`${q.subAccountId}-${q.window}`}
                      className='border-t border-border/60 px-6 py-3 transition-colors hover:bg-muted/50'
                    >
                      <div className='flex items-baseline gap-2'>
                        <span className='text-xs font-medium'>{q.account}</span>
                        <Mono>{q.window}</Mono>
                        <span className='ml-auto font-mono text-xs tabular-nums'>{q.pct}%</span>
                      </div>
                      <div className='mt-2'>
                        <Meter pct={q.pct} />
                      </div>
                      <div className='mt-1.5 text-[11px] text-muted-foreground'>
                        resets in {fmtUntil(q.resetAt, now)}
                      </div>
                    </div>
                  ))
                )}
              </Section>
            </div>
            <div>
              <Section title='Failover activity'>
                {data.failover.length === 0 ? (
                  <div className='px-6 pb-6 text-xs text-muted-foreground'>No failover events in this window.</div>
                ) : (
                  <div className='space-y-0'>
                    {data.failover.map((f) => (
                      <div
                        key={`${f.kind}-${f.at}-${f.headline}`}
                        className='border-t border-border/60 px-6 py-3 transition-colors hover:bg-muted/50'
                      >
                        <div className='flex items-baseline gap-2'>
                          <Pill tone={f.tone}>{f.label}</Pill>
                          <span className='text-xs'>{f.headline}</span>
                          <span className='ml-auto text-[11px] text-muted-foreground'>
                            {f.at === '' ? '' : `${fmtAgo(f.at, now)} ago`}
                          </span>
                        </div>
                        <div className='mt-1 text-[11px] text-muted-foreground'>{f.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>

          <Section title='Recent sessions'>
            <SessionTable data={data} now={now} />
          </Section>
          <div className='h-10' />
        </>
      )}
    </Screen>
  )
}
