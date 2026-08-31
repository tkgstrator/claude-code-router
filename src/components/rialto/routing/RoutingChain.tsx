/**
 * Routing → Chain.
 *
 * The outermost axis is the inbound surface, not the scenario. Whether the
 * router applies at all is a per-surface fact, so the surface is the first
 * thing you pick and its mode is the second — a chain is never shown for
 * traffic that will not walk it. The old build had no such axis, which is
 * how a routing screen could quietly be about one endpoint only.
 */
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfig } from '@/components/ConfigProvider'
import { RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import type { InboundSurfaceWire, RoutingMode, RoutingSchedulerWeightEntry } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AddTargetDialog } from './AddTargetDialog'
import { ChainRail } from './ChainRail'
import { ChainTable } from './ChainTable'
import { useEnabledTargets, usePreferences, useProfiles, useScheduler, useSurfaces } from './data'
import { profileEntryCount, weightIndex } from './derive'
import { PassthroughPanel } from './PassthroughPanel'
import { SurfaceTabs } from './RoutingTabs'
import { Segmented, SurfaceModeBar } from './SurfaceModeBar'
import type { EnabledTarget, Lane, PreferenceEntry, PreferenceProfile, ScenarioKey } from './types'
import { SCENARIOS } from './types'
import { useChainEditing } from './useChainEditing'
import { useRoutingSelection } from './useRoutingSelection'

const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  default: 'Default',
  think: 'Think',
  longContext: 'Long context',
  webSearch: 'Web search',
  image: 'Image'
}

function ScenarioTabs({
  counts,
  active,
  onSelect
}: {
  counts: Record<ScenarioKey, number>
  active: ScenarioKey
  onSelect: (scenario: ScenarioKey) => void
}) {
  return (
    <div className='flex items-center gap-1 border-b border-border px-6'>
      {SCENARIOS.map((scenario) => (
        <button
          key={scenario}
          type='button'
          onClick={() => onSelect(scenario)}
          className={cn(
            'flex items-center gap-2 border-b-2 px-3 py-2 text-xs transition-colors',
            scenario === active
              ? 'border-b-foreground font-medium'
              : 'border-b-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {SCENARIO_LABELS[scenario]}
          <span className='font-mono text-[10px] tabular-nums text-muted-foreground'>{counts[scenario]}</span>
        </button>
      ))}
    </div>
  )
}

function ChainToolbar({
  lane,
  onLane,
  entries,
  targets,
  onAdd,
  onSave,
  saveDisabled
}: {
  lane: Lane
  onLane: (lane: Lane) => void
  entries: readonly PreferenceEntry[]
  targets: readonly EnabledTarget[]
  onAdd: (target: string) => void
  onSave: () => void
  saveDisabled: boolean
}) {
  const disabled = entries.filter((e) => !e.enabled).length
  const taken = useMemo(() => new Set(entries.map((e) => e.target)), [entries])
  return (
    <div className='flex items-center gap-3 px-6 py-3'>
      <Segmented
        value={lane}
        options={[
          { value: 'agent', label: 'Agent' },
          { value: 'subagent', label: 'Subagent' }
        ]}
        onChange={onLane}
      />
      <span className='text-[11px] text-muted-foreground'>
        {entries.length} targets
        {disabled === 0 ? '' : ` · ${disabled} disabled`}
      </span>
      <div className='ml-auto flex gap-2'>
        <AddTargetDialog targets={targets} taken={taken} onAdd={onAdd} />
        <RButton variant='primary' icon='ri-check-line' onClick={onSave} disabled={saveDisabled}>
          Save
        </RButton>
      </div>
    </div>
  )
}

function ChainNote() {
  return (
    <div className='px-6 py-4'>
      <div className='rounded-md border border-dashed border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
        <i className='ri-information-line mr-1 align-[-1px]' />
        Order is preference, top first. A target is skipped when it is disabled, exhausted, or its scheduler weight is{' '}
        <span className='font-mono'>0.00</span>. Weights are published by the routing scheduler every tick — edit the
        chain, not the weights.
      </div>
    </div>
  )
}

/**
 * A profile with no entries anywhere is unconfigured, not broken: the
 * request falls through to the scenario router. Saying "no targets" here
 * would read as "this traffic goes nowhere", which is the opposite of what
 * happens.
 */
function UnconfiguredProfile({ surface }: { surface: InboundSurfaceWire }) {
  return (
    <div className='border-t border-border/60 px-6 py-6'>
      <div className='rounded-md border border-dashed border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
        <i className='ri-information-line mr-1 align-[-1px]' />
        Profile <span className='font-mono'>{surface.profileKey}</span> has no chain configured on any scenario.{' '}
        <span className='font-mono'>{surface.path}</span> still routes — it falls through to the scenario router in the
        Router config. Add a target to make this profile take over.
      </div>
    </div>
  )
}

interface RoutedBodyProps {
  surface: InboundSurfaceWire
  profile: PreferenceProfile
  setProfile: React.Dispatch<React.SetStateAction<PreferenceProfile>>
  scenario: ScenarioKey
  onScenario: (scenario: ScenarioKey) => void
  lane: Lane
  onLane: (lane: Lane) => void
  targets: readonly EnabledTarget[]
  weights: Map<string, RoutingSchedulerWeightEntry>
  onSave: () => void
  saveDisabled: boolean
  onNotify: (text: string, ok: boolean) => void
}

function RoutedBody(props: RoutedBodyProps) {
  const { config } = useConfig()
  const { entries, actions, addTarget, counts } = useChainEditing(
    props.profile,
    props.setProfile,
    props.scenario,
    props.lane
  )

  return (
    <div className='grid grid-cols-[1fr_20rem]'>
      <div className='min-w-0 border-r border-border'>
        <ScenarioTabs counts={counts} active={props.scenario} onSelect={props.onScenario} />
        <ChainToolbar
          lane={props.lane}
          onLane={props.onLane}
          entries={entries}
          targets={props.targets}
          onAdd={addTarget}
          onSave={props.onSave}
          saveDisabled={props.saveDisabled}
        />
        {entries.length === 0 ? (
          profileEntryCount(props.profile.entriesByScenario) === 0 ? (
            <UnconfiguredProfile surface={props.surface} />
          ) : (
            <div className='border-t border-border/60 px-6 py-6 text-xs text-muted-foreground'>
              No targets on this lane yet. Add one to give this scenario a preference order.
            </div>
          )
        ) : (
          <ChainTable entries={entries} weights={props.weights} actions={actions} />
        )}
        <ChainNote />
      </div>
      <ChainRail
        constraints={props.profile.constraints}
        rules={config === null ? [] : config.Router[props.scenario][props.lane].rules}
        onNotify={props.onNotify}
      />
    </div>
  )
}

const subtitleFor = (surface: InboundSurfaceWire): string =>
  surface.routingMode === 'routed' ? 'Per inbound surface · scenario · lane' : `${surface.path} · passthrough`

export function RoutingChain() {
  const navigate = useNavigate()
  const { surfaces, loading, error, setMode, setProfile: setSurfaceProfile } = useSurfaces()
  const profiles = useProfiles()
  const { snapshot: scheduler } = useScheduler()
  const targets = useEnabledTargets()

  const [saving, setSaving] = useState(false)
  // Surface / scenario / lane live in the query string, not in state: the
  // passthrough half of this screen is only reachable as a URL, and an
  // operator mid-way through a chain should survive a reload.
  const { surface, scenario, lane, selectSurface, selectScenario, selectLane } = useRoutingSelection(surfaces)

  const { profile, setProfile, dirty, save } = usePreferences(surface === undefined ? null : surface.profileKey)
  const weights = useMemo(() => weightIndex(scheduler), [scheduler])

  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text)
    else toast.error(text)
  }, [])

  const fail = useCallback((err: unknown) => notify(err instanceof Error ? err.message : String(err), false), [notify])

  const onSave = useCallback(() => {
    setSaving(true)
    save()
      .then((outcome) => {
        notify(outcome.success ? 'Preference chain saved' : 'Could not save the preference chain', outcome.success)
        for (const warning of outcome.warnings) toast.warning(warning)
      })
      .catch(fail)
      .finally(() => setSaving(false))
  }, [save, notify, fail])

  // The mode, the profile and the reset apply on click — there is no
  // Save for them, in the design or here, because each is a single
  // choice rather than an edit in progress. That only reads as
  // deliberate if the write is acknowledged; silence is
  // indistinguishable from a dropped click, which is what makes people
  // go looking for a Save button.
  const onMode = useCallback(
    (mode: RoutingMode) => {
      if (surface === undefined) return
      setMode(surface.id, mode)
        .then(() => notify(`${surface.path} is now ${mode}. Applies to the next request.`, true))
        .catch(fail)
    },
    [surface, setMode, notify, fail]
  )

  const onProfile = useCallback(
    (key: string) => {
      if (surface === undefined) return
      setSurfaceProfile(surface.id, surface.routingMode, key)
        .then(() => notify(`${surface.path} now routes through the ${key} profile.`, true))
        .catch(fail)
    },
    [surface, setSurfaceProfile, notify, fail]
  )

  return (
    <Screen
      title='Routing'
      subtitle={surface === undefined ? undefined : subtitleFor(surface)}
      actions={
        <>
          <RButton variant='outline' icon='ri-node-tree' onClick={() => navigate('/routing/map')}>
            Live map
          </RButton>
          <RButton variant='ghost' icon='ri-play-line' onClick={() => navigate('/routing/rules')}>
            Simulate
          </RButton>
        </>
      }
    >
      {error === null ? null : <div className='px-6 py-6 text-xs text-destructive'>{error}</div>}
      {surface === undefined ? (
        <div className='px-6 py-6 text-xs text-muted-foreground'>{loading ? 'Loading…' : 'No inbound surfaces.'}</div>
      ) : (
        <>
          <SurfaceTabs surfaces={surfaces} active={surface.id} onSelect={selectSurface} />
          <SurfaceModeBar surface={surface} profiles={profiles} onMode={onMode} onProfile={onProfile} />
          {surface.routingMode === 'routed' ? (
            <RoutedBody
              surface={surface}
              profile={profile}
              setProfile={setProfile}
              scenario={scenario}
              onScenario={selectScenario}
              lane={lane}
              onLane={selectLane}
              targets={targets}
              weights={weights}
              onSave={onSave}
              saveDisabled={saving || !dirty}
              onNotify={notify}
            />
          ) : (
            <PassthroughPanel surface={surface} targets={targets} weights={weights} />
          )}
        </>
      )}
    </Screen>
  )
}
