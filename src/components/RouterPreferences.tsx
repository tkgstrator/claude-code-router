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

// Collect the provider list preserving the config order so the
// Add-model dialog shows providers in the order the user configured
// them, with models sorted alphabetically inside each.
const collectProviderIndex = (
  providers: readonly { name: string; models?: readonly string[] }[]
): ProviderModelIndex[] =>
  providers.map((p) => ({ name: p.name, models: [...(p.models ?? [])].sort((a, b) => a.localeCompare(b)) }))

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

export function RouterPreferences() {
  const { t } = useTranslation()
  const { config } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [byScenario, setByScenario] = useState<PreferenceEntriesByScenarioWire>(emptyByScenario)
  const [constraints, setConstraints] = useState<ConstraintsForm>(CONSTRAINT_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scheduler, setScheduler] = useState<RoutingSchedulerStateResponse | null>(null)
  const [activeScenario, setActiveScenario] = useState<PreferenceScenarioKey>('default')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addProvider, setAddProvider] = useState<string>('')
  const [addModel, setAddModel] = useState<string>('')

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
  }, [byScenario, constraints, showToast, t])

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
            const count = byScenario[s].length
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

        <section className='space-y-2'>
          <div className='divide-y border-y empty:border-none'>
            {activeEntries.map((entry, idx) => {
              const badge = weightByTarget.get(entry.target)
              const weightPct = badge === undefined ? null : Math.round(badge.weight * 100)
              return (
                <div
                  key={entry.target}
                  className='flex items-center gap-3 border-l-2 border-l-transparent px-3 py-2 transition-colors hover:border-l-primary hover:bg-muted/50'
                >
                  <span className='w-6 text-center text-muted-foreground text-xs tabular-nums'>{idx + 1}</span>
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
                  <Button size='sm' variant='ghost' onClick={() => move(idx, idx - 1)} disabled={idx === 0}>
                    <ArrowUp className='h-4 w-4' />
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => move(idx, idx + 1)}
                    disabled={idx === activeEntries.length - 1}
                  >
                    <ArrowDown className='h-4 w-4' />
                  </Button>
                  <Button size='sm' variant='ghost' onClick={() => remove(idx)}>
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              )
            })}
            {activeEntries.length === 0 && (
              <div className='px-3 py-4 text-sm text-muted-foreground'>{t('routerPreferences.emptyScenario')}</div>
            )}
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
          <div className='flex items-center justify-between border-b py-2'>
            <Label>{t('routerPreferences.sonnetTierRespect')}</Label>
            <Switch
              checked={constraints.sonnetTierRespect}
              onCheckedChange={(v) => setConstraints((c) => ({ ...c, sonnetTierRespect: v }))}
            />
          </div>
          <div className='flex items-center justify-between border-b py-2'>
            <Label>{t('routerPreferences.haikuTierRespect')}</Label>
            <Switch
              checked={constraints.haikuTierRespect}
              onCheckedChange={(v) => setConstraints((c) => ({ ...c, haikuTierRespect: v }))}
            />
          </div>
          <div className='flex items-center justify-between border-b py-2'>
            <Label className='flex-1'>{t('routerPreferences.minWeightPct')}</Label>
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
          <div className='flex items-center justify-between border-b py-2'>
            <Label>{t('routerPreferences.exhaustedBehavior')}</Label>
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
