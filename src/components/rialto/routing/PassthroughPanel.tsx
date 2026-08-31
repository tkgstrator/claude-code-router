/**
 * The Chain view when the selected surface does not go through the router.
 *
 * The preference chain is not just irrelevant here, it would be actively
 * misleading — nothing in it runs. What matters instead is the set of
 * `provider,model` strings a caller is allowed to name, so that is what
 * the screen shows.
 */
import { useCallback, useState } from 'react'
import { Pill, RButton } from '@/components/rialto/primitives'
import type { InboundSurfaceWire, RoutingSchedulerWeightEntry } from '@/lib/api'
import { STATE_TONE, targetState } from './derive'
import type { EnabledTarget } from './types'

const copy = (text: string): void => {
  // Clipboard access is permission-gated and absent over plain http; a
  // refused copy should leave the table alone rather than throw into the
  // render tree.
  navigator.clipboard?.writeText(text).catch(() => {})
}

function ReachableRow({ entry, live }: { entry: EnabledTarget; live: RoutingSchedulerWeightEntry | undefined }) {
  const state = targetState(live)
  return (
    <tr className='border-t border-border/60 transition-colors hover:bg-muted/50'>
      <td className='py-2.5 pl-6 pr-2 font-mono text-xs'>{entry.target}</td>
      <td className='px-2'>{entry.tier === null ? null : <Pill tone='mute'>{entry.tier}</Pill>}</td>
      <td className='px-2'>
        <Pill tone={STATE_TONE[state]}>{state}</Pill>
      </td>
      <td className='py-2.5 pl-2 pr-6 text-right'>
        <button
          type='button'
          aria-label={`Copy ${entry.target}`}
          onClick={() => copy(entry.target)}
          className='text-muted-foreground/60 hover:text-foreground'
        >
          <i className='ri-file-copy-line text-sm' />
        </button>
      </td>
    </tr>
  )
}

export function PassthroughPanel({
  surface,
  targets,
  weights
}: {
  surface: InboundSurfaceWire
  targets: readonly EnabledTarget[]
  weights: Map<string, RoutingSchedulerWeightEntry>
}) {
  const [copied, setCopied] = useState(false)
  const copyAll = useCallback(() => {
    copy(targets.map((t) => t.target).join('\n'))
    setCopied(true)
  }, [targets])

  return (
    <>
      {/* Own the gap: this heading is the first thing under the mode bar,
          so it cannot lean on a preceding block for spacing. */}
      <div className='flex items-center gap-3 px-6 pt-6 pb-3'>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Reachable targets</h2>
        <span className='text-[11px] text-muted-foreground'>
          what a caller may put in <span className='font-mono'>body.model</span>
        </span>
        <div className='ml-auto'>
          <RButton variant='outline' icon='ri-file-copy-line' onClick={copyAll}>
            {copied ? 'Copied' : 'Copy as list'}
          </RButton>
        </div>
      </div>

      <table className='w-full table-fixed'>
        <colgroup>
          <col />
          <col className='w-24' />
          <col className='w-24' />
          <col className='w-16' />
        </colgroup>
        <thead>
          <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
            <th className='pb-2 pl-6 pr-2 text-left font-medium'>Target</th>
            <th className='px-2 text-left font-medium'>Tier</th>
            <th className='px-2 text-left font-medium'>State</th>
            <th className='pb-2 pl-2 pr-6' />
          </tr>
        </thead>
        <tbody>
          {targets.map((entry) => (
            <ReachableRow key={entry.target} entry={entry} live={weights.get(entry.target)} />
          ))}
        </tbody>
      </table>

      <div className='px-6 py-5'>
        <div className='rounded-md border border-dashed border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
          <i className='ri-lightbulb-line mr-1 align-[-1px]' />
          Switch this surface to <span className='font-mono'>Routed</span> to run {surface.client}&rsquo;s requests
          through scenarios, rules and quota-aware failover. Callers keep sending their own model string — it becomes
          the <span className='font-mono'>requestedModel</span> that rules match on, rather than the final target.
        </div>
      </div>
      <div className='h-8' />
    </>
  )
}
