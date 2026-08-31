/**
 * The bar under the surface tabs: whether the router applies to this
 * surface at all, and which preference profile it draws from.
 *
 * The mode switch writes straight through — there is no draft state for a
 * boolean whose whole purpose is to be flipped and observed. Both controls
 * change what actually routes: `scenario-router.ts` resolves the surface
 * for the inbound path and runs that surface's profile.
 */
import { useState } from 'react'
import { Pill, RButton } from '@/components/rialto/primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { InboundSurfaceWire, RoutingMode } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ProfileSummary } from './types'

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div className='flex rounded-md border border-border p-0.5'>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2.5 py-1 text-[11px]',
            option.value === value
              ? 'bg-foreground font-medium text-background'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Whether this surface is on its shipped default or on an operator's
 * choice. Rendering the two the same way is what let the old build hide a
 * hardcoded bypass behind a screen that looked configured.
 */
function ModeOrigin({ surface, onReset }: { surface: InboundSurfaceWire; onReset: () => void }) {
  if (!surface.overridden) {
    return <span className='text-[11px] text-muted-foreground'>shipped default</span>
  }
  return (
    <>
      <Pill tone='info'>overridden</Pill>
      <RButton variant='ghost' icon='ri-arrow-go-back-line' onClick={onReset}>
        {`Reset to ${surface.defaultRoutingMode}`}
      </RButton>
    </>
  )
}

function ProfilePicker({
  current,
  profiles,
  onSelect
}: {
  current: string
  profiles: readonly ProfileSummary[]
  onSelect: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className='flex items-center gap-2'>
      <span className='text-xs text-muted-foreground'>Profile</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className='inline-flex h-7 items-center gap-2 rounded-md border border-border px-2.5 text-xs hover:bg-muted/60'
          >
            {current}
            <i className='ri-arrow-down-s-line text-sm text-muted-foreground' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-60 p-1'>
          {/* The reserved passthrough profile is deliberately not offered
              here. Selecting it on a surface would mean exactly what the
              Routed/Passthrough toggle two controls to the left already
              means, and two controls for one decision is how they end up
              disagreeing on screen. It stays available for access
              tokens, where it is the only way to express it. */}
          {profiles
            .filter((profile) => profile.kind === 'chain')
            .map((profile) => (
              <button
                key={profile.key}
                type='button'
                onClick={() => {
                  onSelect(profile.key)
                  setOpen(false)
                }}
                className='flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60'
              >
                <span className='truncate'>{profile.key}</span>
                {/* An unconfigured profile is a real choice with a real
                  consequence, so it says so rather than showing a bare 0. */}
                {profile.entryCount === 0 ? (
                  <span className='ml-auto shrink-0 text-[10px] text-muted-foreground'>not configured</span>
                ) : (
                  <span className='ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground'>
                    {profile.entryCount}
                  </span>
                )}
              </button>
            ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

const EXPLAINER = {
  routed: (
    <>
      Passthrough sends the caller&rsquo;s <span className='font-mono'>provider,model</span> straight upstream. Routed
      applies scenarios, rules and quota-aware failover.
    </>
  ),
  passthrough: (
    <>
      The caller&rsquo;s <span className='font-mono'>provider,model</span> goes upstream unchanged. Scenarios, rules,
      quota-aware selection and failover are all skipped.
    </>
  )
} as const

export function SurfaceModeBar({
  surface,
  profiles,
  onMode,
  onReset,
  onProfile
}: {
  surface: InboundSurfaceWire
  profiles: readonly ProfileSummary[]
  onMode: (mode: RoutingMode) => void
  onReset: () => void
  onProfile: (key: string) => void
}) {
  return (
    <div className='flex items-center gap-4 border-b border-border bg-muted/30 px-6 py-3'>
      <div className='flex items-center gap-2'>
        <span className='text-xs text-muted-foreground'>Routing</span>
        <Segmented
          value={surface.routingMode}
          options={[
            { value: 'routed', label: 'Routed' },
            { value: 'passthrough', label: 'Passthrough' }
          ]}
          onChange={onMode}
        />
        <ModeOrigin surface={surface} onReset={onReset} />
      </div>
      {surface.routingMode === 'routed' ? (
        <ProfilePicker current={surface.profileKey} profiles={profiles} onSelect={onProfile} />
      ) : null}
      <p className='ml-auto max-w-md text-right text-[11px] leading-snug text-muted-foreground'>
        {EXPLAINER[surface.routingMode]}
      </p>
    </div>
  )
}
