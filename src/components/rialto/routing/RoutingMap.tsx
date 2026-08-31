/**
 * Routing → Map.
 *
 * One canvas for what used to be three screens (library, live editor,
 * preset editor). It is a live view of the routing that is in force, not a
 * separate draft: the one thing it edits — a surface's routing mode —
 * writes through immediately, because a mode you have to remember to save
 * is a mode you will get wrong.
 */
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfig } from '@/components/ConfigProvider'
import { Pill, RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, type RoutingPresetItem, type SurfaceId } from '@/lib/api'
import { applyPresetToLive } from '@/lib/routing-map/apply-to-live'
import { usePreferences, useProfiles, useScheduler, useSurfaces } from './data'
import { profileEntryCount, profileTargets, weightIndex } from './derive'
import { MapCanvas } from './MapCanvas'
import { RoutingViewTabs } from './RoutingTabs'
import { allRules } from './rules'
import type { ProfileSummary } from './types'
import { SCENARIOS } from './types'

const ZOOM_STEP = 1.2

function ZoomControls({ onZoom, onFit }: { onZoom: (factor: number) => void; onFit: () => void }) {
  const cls = 'px-2 py-1.5 text-muted-foreground hover:bg-muted/60'
  return (
    <div className='absolute left-4 top-4 z-10 flex flex-col overflow-hidden rounded-md border border-border bg-background'>
      <button type='button' aria-label='Zoom in' className={cls} onClick={() => onZoom(ZOOM_STEP)}>
        <i className='ri-add-line text-sm' />
      </button>
      <button
        type='button'
        aria-label='Zoom out'
        className={`border-t border-border ${cls}`}
        onClick={() => onZoom(1 / ZOOM_STEP)}
      >
        <i className='ri-subtract-line text-sm' />
      </button>
      <button type='button' aria-label='Fit' className={`border-t border-border ${cls}`} onClick={onFit}>
        <i className='ri-focus-3-line text-sm' />
      </button>
    </div>
  )
}

function Legend() {
  const item = 'flex items-center gap-1.5 text-[11px] text-muted-foreground'
  return (
    <div className='absolute bottom-4 right-4 z-10 flex items-center gap-3 rounded-md border border-border bg-background px-3 py-1.5'>
      <span className={item}>
        <span className='size-1.5 rounded-full bg-emerald-500' />
        ready
      </span>
      <span className={item}>
        <span className='size-1.5 rounded-full bg-amber-500' />
        throttled
      </span>
      <span className={item}>
        <span className='size-1.5 rounded-full bg-destructive' />
        exhausted
      </span>
      <span className='ml-1 border-l border-border pl-3 text-[11px] text-muted-foreground'>┄ passthrough</span>
    </div>
  )
}

function ProfileButton({
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='inline-flex h-7 items-center gap-2 rounded-md border border-border px-2.5 text-xs hover:bg-muted/60'
        >
          <i className='ri-bookmark-line text-sm text-muted-foreground' />
          {current}
          <i className='ri-arrow-down-s-line text-sm text-muted-foreground' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-52 p-1'>
        {profiles.map((profile) => (
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
            {/* A reserved mode has no chain to count, and a bare 0 beside
                it would read as an empty one. */}
            <span className='ml-auto shrink-0 text-[10px] text-muted-foreground'>
              {profile.kind === 'passthrough' ? (
                'skips routing'
              ) : (
                <span className='font-mono tabular-nums'>{profile.entryCount}</span>
              )}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function PresetsMenu({ onNotify }: { onNotify: (text: string, ok: boolean) => void }) {
  const { config, setConfig } = useConfig()
  const [open, setOpen] = useState(false)
  const [presets, setPresets] = useState<RoutingPresetItem[]>([])

  const load = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) return
      api
        .listRoutingPresets()
        .then((res) => setPresets(res.presets))
        .catch((err: unknown) => onNotify(err instanceof Error ? err.message : String(err), false))
    },
    [onNotify]
  )

  const apply = useCallback(
    async (preset: RoutingPresetItem) => {
      if (config === null) return
      const result = await applyPresetToLive(config, preset.config, preset.name)
      if (result.ok) {
        setConfig(result.updatedConfig)
        onNotify(`Applied "${preset.name}" to live routing`, true)
      } else {
        onNotify(result.message, false)
      }
      setOpen(false)
    },
    [config, setConfig, onNotify]
  )

  const remove = useCallback(
    async (preset: RoutingPresetItem) => {
      await api.deleteRoutingPreset(preset.id)
      setPresets((rows) => rows.filter((r) => r.id !== preset.id))
      onNotify(`Deleted "${preset.name}"`, true)
    },
    [onNotify]
  )

  return (
    <Popover open={open} onOpenChange={load}>
      <PopoverTrigger asChild>
        <RButton variant='outline' icon='ri-archive-drawer-line'>
          Presets
        </RButton>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-64 p-1'>
        {presets.length === 0 ? (
          <p className='px-2 py-1.5 text-[11px] text-muted-foreground'>No saved snapshots yet.</p>
        ) : (
          presets.map((preset) => (
            <div key={preset.id} className='flex items-center gap-1 rounded px-2 py-1.5 text-xs hover:bg-muted/60'>
              <span className='truncate'>{preset.name}</span>
              <button
                type='button'
                className='ml-auto shrink-0 text-[11px] text-muted-foreground hover:text-foreground'
                onClick={() => void apply(preset)}
              >
                Apply
              </button>
              <button
                type='button'
                aria-label={`Delete ${preset.name}`}
                className='shrink-0 text-muted-foreground/60 hover:text-destructive'
                onClick={() => void remove(preset)}
              >
                <i className='ri-delete-bin-line text-sm' />
              </button>
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}

export function RoutingMap() {
  const navigate = useNavigate()
  const { config } = useConfig()
  const { surfaces, reload: reloadSurfaces, setMode } = useSurfaces()
  const profiles = useProfiles()
  const { snapshot: scheduler, reload: reloadScheduler } = useScheduler()
  const [chosenProfile, setChosenProfile] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  // Default to the profile the routed surfaces actually read, so the map
  // opens on the graph that is serving traffic rather than on `live` by
  // convention.
  const routedSurface = surfaces.find((s) => s.routingMode === 'routed')
  const fallbackProfile = routedSurface === undefined ? 'live' : routedSurface.profileKey
  const profileKey = chosenProfile === null ? fallbackProfile : chosenProfile

  const { profile } = usePreferences(surfaces.length === 0 ? null : profileKey)
  const weights = useMemo(() => weightIndex(scheduler), [scheduler])
  const targets = useMemo(() => profileTargets(profile.entriesByScenario), [profile])
  const ruleCount = config === null ? 0 : allRules(config.Router).length

  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text)
    else toast.error(text)
  }, [])

  const write = useCallback(
    (surface: SurfaceId, mode: 'routed' | 'passthrough') => {
      setMode(surface, mode).catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), false))
    },
    [setMode, notify]
  )

  const toggleSurface = useCallback(
    (id: SurfaceId) => {
      const surface = surfaces.find((s) => s.id === id)
      if (surface === undefined) return
      write(id, surface.routingMode === 'routed' ? 'passthrough' : 'routed')
    },
    [surfaces, write]
  )

  const refresh = useCallback(() => {
    reloadSurfaces()
    reloadScheduler()
  }, [reloadSurfaces, reloadScheduler])

  const saveAsPreset = useCallback(() => {
    if (config === null) return
    const name = `Snapshot ${new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(Date.now())}`
    api
      .createRoutingPreset({ name, config: config.Router })
      .then(() => notify(`Saved "${name}"`, true))
      .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), false))
  }, [config, notify])

  return (
    <Screen
      title='Routing map'
      subtitle={`${profileKey} · ${surfaces.length} surfaces · ${SCENARIOS.length} scenarios · ${targets.length} targets`}
      actions={
        <>
          <PresetsMenu onNotify={notify} />
          <RButton variant='ghost' icon='ri-play-line' onClick={() => navigate('/routing/rules')}>
            Simulate
          </RButton>
        </>
      }
    >
      <RoutingViewTabs active='map' ruleCount={ruleCount} />

      <div className='flex items-center gap-3 border-b border-border px-6 py-3'>
        <ProfileButton current={profileKey} profiles={profiles} onSelect={setChosenProfile} />
        {/* An empty graph could mean "unconfigured" or "nothing routes"; only
            the first is true, so it says which. */}
        {profileEntryCount(profile.entriesByScenario) === 0 ? <Pill tone='warn'>not configured</Pill> : null}
        <span className='text-[11px] text-muted-foreground'>
          {surfaces.length} surfaces · {SCENARIOS.length} scenarios · {targets.length} targets
        </span>
        <div className='ml-auto flex gap-2'>
          <RButton variant='outline' icon='ri-bookmark-line' onClick={saveAsPreset}>
            Save as preset
          </RButton>
          <RButton variant='primary' icon='ri-refresh-line' onClick={refresh}>
            Refresh
          </RButton>
        </div>
      </div>

      <div className='relative overflow-hidden border-b border-border bg-muted/20'>
        <ZoomControls
          onZoom={(factor) => setZoom((z) => Math.min(3, Math.max(0.4, z * factor)))}
          onFit={() => setZoom(1)}
        />
        <Legend />
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${100 / zoom}%` }}>
          <MapCanvas
            surfaces={surfaces}
            byScenario={profile.entriesByScenario}
            targets={targets}
            weights={weights}
            onDropOnScenario={(id) => write(id, 'routed')}
            onToggleSurface={toggleSurface}
          />
        </div>
      </div>

      <div className='px-6 py-4'>
        <div className='rounded-md border border-dashed border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
          <i className='ri-information-line mr-1 align-[-1px]' />
          Dashed edges bypass the router entirely — that surface is in passthrough and jumps straight to whatever target
          the caller named. Drag a surface onto a scenario to switch it to routed.
        </div>
      </div>
      <div className='h-6' />
    </Screen>
  )
}
