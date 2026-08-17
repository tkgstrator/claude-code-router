/**
 * Router preference chain editor (Phase 6, per-scenario chains).
 *
 * Each scenario (default / think / longContext / webSearch / image)
 * owns an independent priority chain. The editor renders one tab per
 * scenario; the active tab's chain is what up/down/enable/subagent
 * edits apply to. Save PUTs the whole per-scenario map atomically.
 *
 * Weight + budget badges come from /api/routing-scheduler-state
 * (Phase 5) polled every 30 s. Snapshot weights are keyed by target
 * regardless of scenario, so the same target in different tabs shows
 * the same live weight.
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui-ext/input'
import {
  api,
  type PreferenceEntriesByScenarioWire,
  type PreferenceScenarioKey,
  type RouterPreferenceEntryWire,
  type RoutingSchedulerStateResponse
} from '@/lib/api'
import type { ShellOutletContext } from './AppShell'

const TIERS = ['fable', 'opus', 'sonnet', 'haiku'] as const
type Tier = (typeof TIERS)[number]

const SCENARIOS: readonly PreferenceScenarioKey[] = ['default', 'think', 'longContext', 'webSearch', 'image']

interface ProviderModelIndex {
  name: string
  models: readonly string[]
}

// Only surface models the user has kept enabled: skip whole providers
// switched off, and drop any per-model entry the user has toggled off
// via the transformer._disabledModels list. Matches the "active model"
// gate ModelsDashboard / TierEditor apply so all three surfaces show
// the same rows.
// The wire `transformer` field is typed as an open Record for the
// server-side use array, so narrow it locally to just the two keys the
// active-model gate actually reads.
const readDisabledModels = (transformer: unknown): Set<string> => {
  if (transformer === null || transformer === undefined || typeof transformer !== 'object') return new Set()
  const raw = (transformer as { _disabledModels?: unknown })._disabledModels
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((m): m is string => typeof m === 'string'))
}

interface WireProviderForIndex {
  name: string
  enabled?: boolean
  models?: readonly string[]
  transformer?: unknown
  modelContextWindows?: Record<string, number>
}

const collectProviderIndex = (providers: readonly WireProviderForIndex[]): ProviderModelIndex[] => {
  const out: ProviderModelIndex[] = []
  for (const p of providers) {
    if (p.enabled === false) continue
    const disabled = readDisabledModels(p.transformer)
    const kept = (p.models ?? []).filter((m) => !disabled.has(m))
    if (kept.length === 0) continue
    out.push({ name: p.name, models: [...kept].sort((a, b) => a.localeCompare(b)) })
  }
  return out
}

// Flatten providerIndex to a Set of "provider,model" targets so the
// chain renderer can hide entries pointing at a model the user has
// meanwhile disabled without dropping them from state (a re-enable
// puts them back on screen without a reload).
const activeTargetSet = (providers: readonly ProviderModelIndex[]): Set<string> => {
  const out = new Set<string>()
  for (const p of providers) for (const m of p.models) out.add(`${p.name},${m}`)
  return out
}

interface ConstraintsForm {
  sonnetTierRespect: boolean
  haikuTierRespect: boolean
  minWeightPct: number
  exhaustedBehavior: '429' | 'passthrough'
}

const CONSTRAINT_DEFAULTS: ConstraintsForm = {
  sonnetTierRespect: true,
  haikuTierRespect: true,
  minWeightPct: 1,
  exhaustedBehavior: '429'
}

const readConstraints = (raw: Record<string, unknown> | null): ConstraintsForm => {
  const out: ConstraintsForm = { ...CONSTRAINT_DEFAULTS }
  if (raw === null) return out
  if (typeof raw.sonnetTierRespect === 'boolean') out.sonnetTierRespect = raw.sonnetTierRespect
  if (typeof raw.haikuTierRespect === 'boolean') out.haikuTierRespect = raw.haikuTierRespect
  if (typeof raw.minWeightPct === 'number') out.minWeightPct = raw.minWeightPct
  if (raw.exhaustedBehavior === '429' || raw.exhaustedBehavior === 'passthrough') {
    out.exhaustedBehavior = raw.exhaustedBehavior
  }
  return out
}

const emptyByKind = (): { agent: RouterPreferenceEntryWire[]; subagent: RouterPreferenceEntryWire[] } => ({
  agent: [],
  subagent: []
})

const emptyByScenario = (): PreferenceEntriesByScenarioWire => ({
  default: emptyByKind(),
  think: emptyByKind(),
  longContext: emptyByKind(),
  webSearch: emptyByKind(),
  image: emptyByKind()
})

const SCHEDULER_POLL_MS = 30_000

// Sentinel for the persona Select's "no persona" option. Radix Select
// rejects an empty string value, so we map absence to this literal and
// translate back to `undefined` at write time. Same sentinel the
// RoutingEditor uses so the two persona pickers stay symmetric.
const PERSONA_NONE = '__none__'

// Fallback shown in the manual editor when the operator flips off
// "Auto" without a stored threshold — matches the runtime's ultimate
// fallback in effectiveLongContextThreshold so a naive Save doesn't
// silently change routing behaviour.
const DEFAULT_LONG_CONTEXT_THRESHOLD = 128000

// Fraction of the default agent primary's context window used by the
// auto path. Mirrors LONG_CONTEXT_AUTO_RATIO in
// src/llms/scenario-router/model-selection.ts so the caption reflects
// what the runtime will actually compute — bump them together if the
// ratio ever changes.
const LONG_CONTEXT_AUTO_RATIO = 0.7

// Look up a "provider,model" primary in the config's provider list and
// return { model, contextWindow } — with contextWindow null when the
// vendor didn't publish a value. Used to render the auto-threshold
// caption; the runtime does the same resolution via cfg.Providers in
// context.ts.
const resolveDefaultPrimaryWindow = (
  primary: string | null,
  providers: readonly WireProviderForIndex[]
): { modelName: string; contextWindow: number | null } | null => {
  if (typeof primary !== 'string' || primary === '') return null
  const comma = primary.indexOf(',')
  if (comma <= 0) return null
  const providerName = primary.slice(0, comma)
  const modelName = primary.slice(comma + 1)
  const provider = providers.find((p) => p.name === providerName)
  if (!provider) return null
  const window = provider.modelContextWindows?.[modelName]
  return { modelName, contextWindow: typeof window === 'number' && window > 0 ? window : null }
}

export function RouterPreferences() {
  const { t } = useTranslation()
  const { config, reloadConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [byScenario, setByScenario] = useState<PreferenceEntriesByScenarioWire>(emptyByScenario)
  const [constraints, setConstraints] = useState<ConstraintsForm>(CONSTRAINT_DEFAULTS)
  // longContext threshold lives on Router.longContext.threshold (not
  // on the preference constraints blob), so we mirror it in local
  // state and PATCH it via /api/config on Save when it changed. The
  // scenario classifier reads this value to decide when a request
  // qualifies as long-context. `null` means "auto" — the runtime
  // derives the effective value from the default agent primary's
  // contextWindow; the manual input remembers its last numeric value so
  // toggling Auto off returns the operator to a sensible starting point
  // instead of a blank / 0 field.
  const initialThreshold = config?.Router.longContext.threshold ?? null
  const [longContextThreshold, setLongContextThreshold] = useState<number | null>(initialThreshold)
  const [manualThresholdMemo, setManualThresholdMemo] = useState<number>(
    initialThreshold ?? DEFAULT_LONG_CONTEXT_THRESHOLD
  )
  const [thresholdBaseline, setThresholdBaseline] = useState<number | null>(initialThreshold)
  // Persona also lives on Router (not on the preference constraints
  // blob), so we mirror + patch it the same way as the threshold.
  // Empty / undefined on the wire reads as "no persona".
  const initialPersona: string | null =
    typeof config?.Router.persona === 'string' && config.Router.persona !== '' ? config.Router.persona : null
  const [persona, setPersona] = useState<string | null>(initialPersona)
  const [personaBaseline, setPersonaBaseline] = useState<string | null>(initialPersona)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scheduler, setScheduler] = useState<RoutingSchedulerStateResponse | null>(null)
  const [activeScenario, setActiveScenario] = useState<PreferenceScenarioKey>('default')
  // Which caller lane the tab currently edits — every mutation
  // (add/remove/reorder/enable) applies to `byScenario[activeScenario][activeKind]`.
  const [activeKind, setActiveKind] = useState<'agent' | 'subagent'>('agent')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addProvider, setAddProvider] = useState<string>('')
  const [addModel, setAddModel] = useState<string>('')

  // Re-sync the threshold input when config lands / reloads. The
  // baseline holds the value we last read from the server so Save can
  // skip the /api/config round-trip when the user didn't touch it.
  useEffect(() => {
    if (config === null) return
    const v = config.Router.longContext.threshold ?? null
    setLongContextThreshold(v)
    setThresholdBaseline(v)
    if (typeof v === 'number') setManualThresholdMemo(v)
    const p = typeof config.Router.persona === 'string' && config.Router.persona !== '' ? config.Router.persona : null
    setPersona(p)
    setPersonaBaseline(p)
  }, [config])

  useEffect(() => {
    let cancelled = false
    void api
      .getRouterPreferences()
      .then((p) => {
        if (cancelled) return
        setByScenario(p.entriesByScenario)
        setConstraints(readConstraints(p.constraints))
      })
      .catch((err) =>
        showToast(`Failed to load preferences: ${err instanceof Error ? err.message : String(err)}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showToast])

  useEffect(() => {
    let cancelled = false
    const fetchOnce = (): void => {
      void api
        .getRoutingSchedulerState()
        .then((s) => {
          if (!cancelled) setScheduler(s)
        })
        .catch(() => {})
    }
    fetchOnce()
    const id = setInterval(fetchOnce, SCHEDULER_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const providerIndex = useMemo(() => collectProviderIndex(config?.Providers ?? []), [config])
  // Targets the active-model gate accepts. Chain rendering hides
  // entries whose target is not here (a stale row for a since-disabled
  // model would otherwise sit in the list with no way to route to it).
  const activeModelTargets = useMemo(() => activeTargetSet(providerIndex), [providerIndex])
  const activeTargets = useMemo(
    () => new Set(byScenario[activeScenario][activeKind].map((e) => e.target)),
    [byScenario, activeScenario, activeKind]
  )
  const modelsForAddProvider = useMemo(() => {
    const p = providerIndex.find((x) => x.name === addProvider)
    if (p === undefined) return [] as readonly string[]
    return p.models.filter((m) => !activeTargets.has(`${p.name},${m}`))
  }, [providerIndex, addProvider, activeTargets])
  const weightByTarget = useMemo(() => {
    const m = new Map<string, { weight: number; budget: number | null }>()
    for (const w of scheduler?.weights ?? []) m.set(w.target, { weight: w.weight, budget: w.remainingBudgetPct })
    return m
  }, [scheduler])

  const activeEntries = byScenario[activeScenario][activeKind]

  const mutateActive = useCallback(
    (fn: (prev: RouterPreferenceEntryWire[]) => RouterPreferenceEntryWire[]) => {
      setByScenario((prev) => ({
        ...prev,
        [activeScenario]: { ...prev[activeScenario], [activeKind]: fn(prev[activeScenario][activeKind]) }
      }))
    },
    [activeScenario, activeKind]
  )

  const move = useCallback(
    (from: number, to: number) => {
      mutateActive((prev) => {
        if (to < 0 || to >= prev.length) return prev
        const next = [...prev]
        const [pulled] = next.splice(from, 1)
        next.splice(to, 0, pulled)
        return next.map((e, i) => ({ ...e, priority: i + 1 }))
      })
    },
    [mutateActive]
  )

  const remove = useCallback(
    (idx: number) => {
      mutateActive((prev) => prev.filter((_, i) => i !== idx).map((e, i) => ({ ...e, priority: i + 1 })))
    },
    [mutateActive]
  )

  const setEnabled = useCallback(
    (idx: number, enabled: boolean) => {
      mutateActive((prev) => prev.map((e, i) => (i === idx ? { ...e, enabled } : e)))
    },
    [mutateActive]
  )

  const toggleSubagentTier = useCallback(
    (idx: number, tier: Tier) => {
      mutateActive((prev) =>
        prev.map((e, i) => {
          if (i !== idx) return e
          const has = e.subagentTiers.includes(tier)
          const next = has ? e.subagentTiers.filter((x) => x !== tier) : [...e.subagentTiers, tier]
          return { ...e, subagentTiers: next }
        })
      )
    },
    [mutateActive]
  )

  const openAddDialog = useCallback(() => {
    setAddProvider('')
    setAddModel('')
    setAddDialogOpen(true)
  }, [])

  const confirmAdd = useCallback(() => {
    if (addProvider === '' || addModel === '') return
    const target = `${addProvider},${addModel}`
    mutateActive((prev) => {
      if (prev.some((e) => e.target === target)) return prev
      return [...prev, { priority: prev.length + 1, target, enabled: true, subagentTiers: [] }]
    })
    setAddDialogOpen(false)
    setAddProvider('')
    setAddModel('')
  }, [addProvider, addModel, mutateActive])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const outcome = await api.putRouterPreferences({
        entriesByScenario: byScenario,
        constraints: {
          sonnetTierRespect: constraints.sonnetTierRespect,
          haikuTierRespect: constraints.haikuTierRespect,
          minWeightPct: constraints.minWeightPct,
          exhaustedBehavior: constraints.exhaustedBehavior
        }
      })
      // Threshold and persona are edited on this page but live on the
      // Router (not on the preference constraints blob) — patch them
      // via /api/config only when the user actually changed one, so
      // unrelated fields on the Router stay untouched and a no-op
      // Save doesn't churn config.json. `null` is the wire
      // representation of "auto" for threshold and "no persona" for
      // persona.
      const nextThreshold = longContextThreshold === null || longContextThreshold > 0 ? longContextThreshold : null
      const thresholdChanged = nextThreshold !== thresholdBaseline
      const personaChanged = persona !== personaBaseline
      if (config !== null && (thresholdChanged || personaChanged)) {
        await api.updateConfig({
          ...config,
          Router: {
            ...config.Router,
            longContext: { ...config.Router.longContext, threshold: nextThreshold },
            persona: persona ?? undefined
          }
        })
        await reloadConfig()
      }
      if (outcome.success) {
        showToast(t('routerPreferences.saved'), 'success')
        for (const w of outcome.warnings) showToast(w, 'warning')
      } else {
        showToast(t('routerPreferences.saveFailed'), 'error')
      }
    } catch (err) {
      showToast(`${t('routerPreferences.saveFailed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [
    byScenario,
    constraints,
    config,
    longContextThreshold,
    thresholdBaseline,
    persona,
    personaBaseline,
    reloadConfig,
    showToast,
    t
  ])

  if (loading) {
    return (
      <PageContainer>
        <PageHeader title={t('routerPreferences.title')} />
        <PageContent>
          <div className='text-muted-foreground p-6'>{t('app.loading')}</div>
        </PageContent>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader title={t('routerPreferences.title')} />
      <PageContent className='space-y-6'>
        <p className='text-muted-foreground text-sm'>{t('routerPreferences.description')}</p>

        {scheduler !== null && scheduler.tickAt === null && (
          <p className='text-muted-foreground text-xs'>{t('routerPreferences.noSchedulerData')}</p>
        )}

        {/* Persona lives on the Router (not the preference blob) but is
            edited here so the operator can pick the whole routing +
            persona pairing in one place. Mirrors the RoutingEditor's
            selector; both write to Router.persona through /api/config. */}
        <div className='flex items-center gap-3'>
          <Label htmlFor='routerPreferencesPersona' className='text-xs text-muted-foreground'>
            {t('router.persona')}
          </Label>
          <Select value={persona ?? PERSONA_NONE} onValueChange={(v) => setPersona(v === PERSONA_NONE ? null : v)}>
            <SelectTrigger
              id='routerPreferencesPersona'
              size='sm'
              aria-label={t('router.persona')}
              className='h-8 w-56 text-xs'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PERSONA_NONE}>{t('router.personaNone')}</SelectItem>
              {(config?.Personas ?? [])
                .filter(
                  (p): p is { id: string; name: string; prompt: string } => typeof p.id === 'string' && p.id !== ''
                )
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex flex-wrap gap-1 border-b'>
          {SCENARIOS.map((s) => {
            // Count what the user will actually see on this tab, not the
            // raw entry count — a scenario whose four rows all point at
            // since-disabled models should not read "4" while the tab
            // itself renders empty.
            // Count both kinds so a scenario badge reflects total configured
            // routing regardless of which kind sub-tab the operator lands on.
            const count = (['agent', 'subagent'] as const).reduce(
              (acc, k) => acc + byScenario[s][k].filter((e) => activeModelTargets.has(e.target)).length,
              0
            )
            const active = activeScenario === s
            return (
              <button
                key={s}
                type='button'
                onClick={() => setActiveScenario(s)}
                className={
                  active
                    ? '-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium'
                    : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
                }
              >
                {t(`routerPreferences.scenario.${s}`)}
                <span className='ml-2 text-muted-foreground tabular-nums'>{count}</span>
              </button>
            )
          })}
        </div>

        {activeScenario === 'longContext' &&
          (() => {
            const isAuto = longContextThreshold === null
            const defaultPrimary = config?.Router.default.agent.primary ?? null
            const resolved = resolveDefaultPrimaryWindow(defaultPrimary, config?.Providers ?? [])
            const autoValue =
              resolved?.contextWindow !== undefined && resolved?.contextWindow !== null
                ? Math.floor(resolved.contextWindow * LONG_CONTEXT_AUTO_RATIO)
                : DEFAULT_LONG_CONTEXT_THRESHOLD
            const autoCaption = resolved?.contextWindow
              ? t('routerPreferences.longContextThresholdAutoResolved', {
                  value: autoValue.toLocaleString(),
                  model: resolved.modelName
                })
              : t('routerPreferences.longContextThresholdAutoUnresolved', {
                  value: autoValue.toLocaleString()
                })
            return (
              <div className='flex items-start justify-between gap-4 border-b py-3'>
                <div className='min-w-0 flex-1 space-y-0.5'>
                  <Label htmlFor='longContextThreshold'>{t('router.longContextThreshold')}</Label>
                  <p className='text-muted-foreground text-xs'>{t('routerPreferences.longContextThresholdHelp')}</p>
                  {isAuto && <p className='text-muted-foreground text-xs'>{autoCaption}</p>}
                </div>
                <div className='flex items-center gap-3'>
                  <div className='flex items-center gap-2'>
                    <Switch
                      id='longContextThresholdAuto'
                      checked={isAuto}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setLongContextThreshold(null)
                        } else {
                          setLongContextThreshold(manualThresholdMemo)
                        }
                      }}
                      aria-label={t('routerPreferences.longContextThresholdAuto')}
                    />
                    <Label htmlFor='longContextThresholdAuto' className='text-xs font-normal'>
                      {t('routerPreferences.longContextThresholdAuto')}
                    </Label>
                  </div>
                  <Input
                    id='longContextThreshold'
                    type='number'
                    min={1}
                    step={1000}
                    className='w-32 text-right tabular-nums'
                    value={longContextThreshold ?? ''}
                    disabled={isAuto}
                    onChange={(e) => {
                      const v = e.target.valueAsNumber
                      if (Number.isFinite(v) && v > 0) {
                        setLongContextThreshold(v)
                        setManualThresholdMemo(v)
                      }
                    }}
                  />
                  <span className='text-muted-foreground text-xs'>tokens</span>
                </div>
              </div>
            )
          })()}

        {/* Agent / Subagent sub-tabs inside the active scenario. The two
            lanes have independent ordered chains, so switching here
            swaps the entire list below (add / reorder / enable operate
            on the current kind). Count per kind matches the raw active
            chain length after the same active-model gate. */}
        <div className='flex items-center gap-1 rounded-md bg-muted p-0.5'>
          {(['agent', 'subagent'] as const).map((k) => {
            const kindCount = byScenario[activeScenario][k].filter((e) => activeModelTargets.has(e.target)).length
            const active = activeKind === k
            return (
              <button
                key={k}
                type='button'
                onClick={() => setActiveKind(k)}
                className={
                  active
                    ? 'rounded-sm bg-background px-3 py-1 text-xs font-medium shadow-sm'
                    : 'rounded-sm px-3 py-1 text-xs text-muted-foreground hover:text-foreground'
                }
              >
                {t(`routerPreferences.kind.${k}`)}
                <span className='ml-2 text-muted-foreground tabular-nums'>{kindCount}</span>
              </button>
            )
          })}
        </div>

        <section className='space-y-2'>
          {(() => {
            // Filter entries whose target model has since been disabled at
            // the provider level — the row stays in state (a re-enable puts
            // it back on screen instantly) but hiding it from the chain
            // matches the "active model" gate TierEditor / ModelsDashboard
            // apply. Preserve the raw index alongside the visible position
            // so move / remove / enable / toggleSubagentTier still target
            // the correct element inside the full activeEntries array.
            const visible = activeEntries
              .map((entry, idx) => ({ entry, idx }))
              .filter(({ entry }) => activeModelTargets.has(entry.target))
            // Only reserve the weight / budget columns when the scheduler
            // is actually publishing snapshots — otherwise every row would
            // waste horizontal space on two em-dash placeholders.
            const hasLiveData = scheduler !== null && scheduler.tickAt !== null
            if (visible.length === 0) {
              return (
                <div className='border-y px-3 py-4 text-sm text-muted-foreground'>
                  {t('routerPreferences.emptyScenario')}
                </div>
              )
            }
            return (
              <div className='divide-y border-y'>
                {hasLiveData && (
                  <div className='flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground'>
                    <span className='w-7 shrink-0' />
                    <span className='flex-1' />
                    <span className='w-14 text-right'>{t('routerPreferences.columnWeight')}</span>
                    <span className='w-14 text-right'>{t('routerPreferences.columnBudget')}</span>
                    <span className='w-11 shrink-0' />
                    <span className='w-24 shrink-0' />
                  </div>
                )}
                {visible.map(({ entry, idx }, visIdx) => {
                  const badge = weightByTarget.get(entry.target)
                  const weightPct = badge === undefined ? null : Math.round(badge.weight * 100)
                  const prevRealIdx = visIdx === 0 ? null : visible[visIdx - 1].idx
                  const nextRealIdx = visIdx === visible.length - 1 ? null : visible[visIdx + 1].idx
                  // Split "provider,model" so the model name gets the visual
                  // weight (that's what people scan for) and the provider
                  // sits alongside in muted text. Falls back to the raw
                  // target for malformed rows that missed a comma.
                  const commaIdx = entry.target.indexOf(',')
                  const providerName = commaIdx > 0 ? entry.target.slice(0, commaIdx) : ''
                  const modelName = commaIdx > 0 ? entry.target.slice(commaIdx + 1) : entry.target
                  return (
                    <div
                      key={entry.target}
                      className={
                        entry.enabled
                          ? 'group flex flex-col gap-2 border-l-2 border-l-transparent px-3 py-2.5 transition-colors hover:border-l-primary hover:bg-muted/50'
                          : 'group flex flex-col gap-2 border-l-2 border-l-transparent px-3 py-2.5 text-muted-foreground opacity-60 transition-colors hover:border-l-primary hover:bg-muted/50'
                      }
                    >
                      <div className='flex items-center gap-3'>
                        <span className='w-7 shrink-0 text-center text-muted-foreground text-xs tabular-nums'>
                          {visIdx + 1}
                        </span>
                        <div className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                          <span className='font-medium text-sm'>{modelName}</span>
                          {providerName !== '' && (
                            <span className='truncate text-muted-foreground text-xs'>{providerName}</span>
                          )}
                        </div>
                        {hasLiveData && (
                          <>
                            <span className='w-14 text-right text-muted-foreground text-xs tabular-nums'>
                              {weightPct !== null ? `${weightPct}%` : '—'}
                            </span>
                            <span className='w-14 text-right text-muted-foreground text-xs tabular-nums'>
                              {badge?.budget != null ? `${badge.budget}%` : '—'}
                            </span>
                          </>
                        )}
                        <Switch
                          checked={entry.enabled}
                          onCheckedChange={(next) => setEnabled(idx, next)}
                          aria-label={t('app.enable')}
                        />
                        <div className='flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-7 w-7 p-0'
                            onClick={() => prevRealIdx !== null && move(idx, prevRealIdx)}
                            disabled={prevRealIdx === null}
                            aria-label={t('app.moveUp')}
                          >
                            <ArrowUp className='h-4 w-4' />
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-7 w-7 p-0'
                            onClick={() => nextRealIdx !== null && move(idx, nextRealIdx)}
                            disabled={nextRealIdx === null}
                            aria-label={t('app.moveDown')}
                          >
                            <ArrowDown className='h-4 w-4' />
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-7 w-7 p-0 text-destructive hover:text-destructive'
                            onClick={() => remove(idx)}
                            aria-label={t('app.delete')}
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        </div>
                      </div>
                      <div className='flex items-center gap-1.5 pl-10 text-xs'>
                        <span className='text-muted-foreground'>{t('routerPreferences.subagentTiers')}</span>
                        {TIERS.map((tier) => {
                          const on = entry.subagentTiers.includes(tier)
                          return (
                            <button
                              key={tier}
                              type='button'
                              className={
                                on
                                  ? 'rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary'
                                  : 'rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground hover:bg-muted'
                              }
                              onClick={() => toggleSubagentTier(idx, tier)}
                            >
                              {tier}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          <div className='flex items-center justify-end pt-3'>
            <Button onClick={openAddDialog}>
              <Plus className='h-4 w-4' />
              {t('routerPreferences.addModel')}
            </Button>
          </div>
        </section>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>{t('routerPreferences.addDialog.title')}</DialogTitle>
              <DialogDescription>
                {t('routerPreferences.addDialog.description', {
                  scenario: t(`routerPreferences.scenario.${activeScenario}`)
                })}
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-4 py-2'>
              <div className='space-y-1.5'>
                <Label>{t('routerPreferences.addDialog.provider')}</Label>
                <Select
                  value={addProvider}
                  onValueChange={(v) => {
                    setAddProvider(v)
                    setAddModel('')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('routerPreferences.addDialog.selectProvider')} />
                  </SelectTrigger>
                  <SelectContent>
                    {providerIndex.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <Label>{t('routerPreferences.addDialog.model')}</Label>
                <Select value={addModel} onValueChange={setAddModel} disabled={addProvider === ''}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        addProvider === ''
                          ? t('routerPreferences.addDialog.pickProviderFirst')
                          : modelsForAddProvider.length === 0
                            ? t('routerPreferences.addDialog.allAdded')
                            : t('routerPreferences.addDialog.selectModel')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {modelsForAddProvider.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant='ghost' onClick={() => setAddDialogOpen(false)}>
                {t('app.cancel')}
              </Button>
              <Button onClick={confirmAdd} disabled={addProvider === '' || addModel === ''}>
                {t('routerPreferences.addModel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <section className='space-y-3'>
          <h2 className='font-medium text-sm'>{t('routerPreferences.constraints')}</h2>
          <div className='flex items-start justify-between gap-4 border-b py-3'>
            <div className='min-w-0 flex-1 space-y-0.5'>
              <Label>{t('routerPreferences.sonnetTierRespect')}</Label>
              <p className='text-muted-foreground text-xs'>{t('routerPreferences.sonnetTierRespectHelp')}</p>
            </div>
            <Switch
              checked={constraints.sonnetTierRespect}
              onCheckedChange={(v) => setConstraints((c) => ({ ...c, sonnetTierRespect: v }))}
            />
          </div>
          <div className='flex items-start justify-between gap-4 border-b py-3'>
            <div className='min-w-0 flex-1 space-y-0.5'>
              <Label>{t('routerPreferences.haikuTierRespect')}</Label>
              <p className='text-muted-foreground text-xs'>{t('routerPreferences.haikuTierRespectHelp')}</p>
            </div>
            <Switch
              checked={constraints.haikuTierRespect}
              onCheckedChange={(v) => setConstraints((c) => ({ ...c, haikuTierRespect: v }))}
            />
          </div>
          <div className='flex items-start justify-between gap-4 border-b py-3'>
            <div className='min-w-0 flex-1 space-y-0.5'>
              <Label>{t('routerPreferences.minWeightPct')}</Label>
              <p className='text-muted-foreground text-xs'>{t('routerPreferences.minWeightPctHelp')}</p>
            </div>
            <Input
              type='number'
              min={0}
              max={10}
              step={0.5}
              value={constraints.minWeightPct}
              onChange={(e) => setConstraints((c) => ({ ...c, minWeightPct: Number.parseFloat(e.target.value) }))}
              className='w-24 tabular-nums'
            />
          </div>
          <div className='flex items-start justify-between gap-4 border-b py-3'>
            <div className='min-w-0 flex-1 space-y-0.5'>
              <Label>{t('routerPreferences.exhaustedBehavior')}</Label>
              <p className='text-muted-foreground text-xs'>
                {constraints.exhaustedBehavior === '429'
                  ? t('routerPreferences.exhaustedBehaviorHelp429')
                  : t('routerPreferences.exhaustedBehaviorHelpPassthrough')}
              </p>
            </div>
            <Select
              value={constraints.exhaustedBehavior}
              onValueChange={(v) =>
                setConstraints((c) => ({ ...c, exhaustedBehavior: v === 'passthrough' ? 'passthrough' : '429' }))
              }
            >
              <SelectTrigger className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='429'>429 + Retry-After</SelectItem>
                <SelectItem value='passthrough'>passthrough</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <div className='flex justify-end'>
          <Button onClick={save} disabled={saving}>
            {saving ? t('app.saving') : t('app.save')}
          </Button>
        </div>
      </PageContent>
    </PageContainer>
  )
}
