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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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

const emptyByScenario = (): PreferenceEntriesByScenarioWire => ({
  default: [],
  think: [],
  longContext: [],
  webSearch: [],
  image: []
})

const SCHEDULER_POLL_MS = 30_000

const DEFAULT_LONG_CONTEXT_THRESHOLD = 128000

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
  // qualifies as long-context.
  const initialThreshold = config?.Router.longContext.threshold ?? DEFAULT_LONG_CONTEXT_THRESHOLD
  const [longContextThreshold, setLongContextThreshold] = useState<number>(initialThreshold)
  const [thresholdBaseline, setThresholdBaseline] = useState<number>(initialThreshold)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scheduler, setScheduler] = useState<RoutingSchedulerStateResponse | null>(null)
  const [activeScenario, setActiveScenario] = useState<PreferenceScenarioKey>('default')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addProvider, setAddProvider] = useState<string>('')
  const [addModel, setAddModel] = useState<string>('')

  // Re-sync the threshold input when config lands / reloads. The
  // baseline holds the value we last read from the server so Save can
  // skip the /api/config round-trip when the user didn't touch it.
  useEffect(() => {
    if (config === null) return
    const v = config.Router.longContext.threshold ?? DEFAULT_LONG_CONTEXT_THRESHOLD
    setLongContextThreshold(v)
    setThresholdBaseline(v)
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
    () => new Set(byScenario[activeScenario].map((e) => e.target)),
    [byScenario, activeScenario]
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

  const activeEntries = byScenario[activeScenario]

  const mutateActive = useCallback(
    (fn: (prev: RouterPreferenceEntryWire[]) => RouterPreferenceEntryWire[]) => {
      setByScenario((prev) => ({ ...prev, [activeScenario]: fn(prev[activeScenario]) }))
    },
    [activeScenario]
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
      // Threshold is edited on this page but lives on Router.longContext,
      // not on the preference constraints blob — patch it via /api/config
      // only when the user actually changed it, so unrelated fields on the
      // Router stay untouched and a no-op Save doesn't churn config.json.
      if (config !== null && longContextThreshold !== thresholdBaseline && Number.isFinite(longContextThreshold)) {
        await api.updateConfig({
          ...config,
          Router: {
            ...config.Router,
            longContext: { ...config.Router.longContext, threshold: longContextThreshold }
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
  }, [byScenario, constraints, config, longContextThreshold, thresholdBaseline, reloadConfig, showToast, t])

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
          <div className='rounded border-l-2 border-l-amber-500 bg-amber-500/5 px-3 py-2 text-sm'>
            {t('routerPreferences.noSchedulerData')}
          </div>
        )}

        <div className='flex flex-wrap gap-1 border-b'>
          {SCENARIOS.map((s) => {
            // Count what the user will actually see on this tab, not the
            // raw entry count — a scenario whose four rows all point at
            // since-disabled models should not read "4" while the tab
            // itself renders empty.
            const count = byScenario[s].filter((e) => activeModelTargets.has(e.target)).length
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

        {activeScenario === 'longContext' && (
          <div className='flex items-center gap-3 rounded border-l-2 border-l-primary/40 bg-muted/30 px-3 py-2'>
            <Label htmlFor='longContextThreshold' className='text-xs text-muted-foreground'>
              {t('router.longContextThreshold')}
            </Label>
            <Input
              id='longContextThreshold'
              type='number'
              min={1}
              step={1000}
              className='h-7 w-32 text-xs tabular-nums'
              value={longContextThreshold}
              onChange={(e) => {
                const v = e.target.valueAsNumber
                if (Number.isFinite(v)) setLongContextThreshold(v)
              }}
            />
            <span className='text-xs text-muted-foreground'>tokens</span>
          </div>
        )}

        <section className='space-y-2'>
          <div className='divide-y border-y empty:border-none'>
            {(() => {
              // Filter out entries whose target model has since been
              // disabled at the provider level — the row stays in state
              // (a re-enable puts it back on screen instantly) but
              // hiding it from the chain matches the "active model" gate
              // TierEditor / ModelsDashboard apply. Preserve the raw
              // index alongside the visible position so move / remove /
              // enable / toggleSubagentTier still target the correct
              // element inside the full activeEntries array.
              const visible = activeEntries
                .map((entry, idx) => ({ entry, idx }))
                .filter(({ entry }) => activeModelTargets.has(entry.target))
              if (visible.length === 0) {
                return (
                  <div className='px-3 py-4 text-sm text-muted-foreground'>{t('routerPreferences.emptyScenario')}</div>
                )
              }
              return visible.map(({ entry, idx }, visIdx) => {
                const badge = weightByTarget.get(entry.target)
                const weightPct = badge === undefined ? null : Math.round(badge.weight * 100)
                const prevRealIdx = visIdx === 0 ? null : visible[visIdx - 1].idx
                const nextRealIdx = visIdx === visible.length - 1 ? null : visible[visIdx + 1].idx
                return (
                  <div
                    key={entry.target}
                    className='flex items-center gap-3 border-l-2 border-l-transparent px-3 py-2 transition-colors hover:border-l-primary hover:bg-muted/50'
                  >
                    <span className='w-6 text-center text-muted-foreground text-xs tabular-nums'>{visIdx + 1}</span>
                    <div className='flex flex-1 flex-col gap-1'>
                      <span className='font-medium text-sm'>{entry.target}</span>
                      <div className='flex flex-wrap gap-1 text-xs text-muted-foreground'>
                        <span>{t('routerPreferences.subagentTiers')}:</span>
                        {TIERS.map((tier) => (
                          <button
                            key={tier}
                            type='button'
                            className={
                              entry.subagentTiers.includes(tier)
                                ? 'rounded bg-primary/10 px-1.5 py-0.5 text-primary'
                                : 'rounded bg-muted px-1.5 py-0.5 text-muted-foreground hover:bg-muted/70'
                            }
                            onClick={() => toggleSubagentTier(idx, tier)}
                          >
                            {tier}
                          </button>
                        ))}
                      </div>
                    </div>
                    {weightPct !== null && (
                      <span className='w-16 text-right text-muted-foreground text-xs tabular-nums'>{weightPct}%</span>
                    )}
                    {badge?.budget != null && (
                      <span className='w-14 text-right text-muted-foreground text-xs tabular-nums'>
                        {t('routerPreferences.budget')}: {badge.budget}%
                      </span>
                    )}
                    <Switch checked={entry.enabled} onCheckedChange={(next) => setEnabled(idx, next)} />
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => prevRealIdx !== null && move(idx, prevRealIdx)}
                      disabled={prevRealIdx === null}
                    >
                      <ArrowUp className='h-4 w-4' />
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => nextRealIdx !== null && move(idx, nextRealIdx)}
                      disabled={nextRealIdx === null}
                    >
                      <ArrowDown className='h-4 w-4' />
                    </Button>
                    <Button size='sm' variant='ghost' onClick={() => remove(idx)}>
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  </div>
                )
              })
            })()}
          </div>

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
              className='w-24'
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
