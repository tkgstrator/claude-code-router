/**
 * The Sessions table.
 *
 * Ten columns whose widths are declared once in the colgroup and never
 * again — the row builds cells in the same order and relies on it. That
 * coupling is the reason the two components sit in one file and the
 * screen sees neither.
 */
import { Link } from 'react-router-dom'
import type { Enriched } from '@/components/rialto/activity/sessions-derive'
import { Sparkline, SurfaceCell } from '@/components/rialto/activity/shared'
import { fmtAgo } from '@/lib/rialto/format'
import { fmtCost, fmtTokens } from '@/lib/sessions/format'

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

export function SessionsTable({ rows, now }: { rows: Enriched[]; now: number }) {
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
