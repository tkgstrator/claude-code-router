/**
 * Router preference chain editor (Phase 6).
 *
 * Reads GET /api/router-preferences to load the singleton chain,
 * lets the user reorder entries with up/down buttons, toggle
 * enable/subagent tiers, edit a subset of constraints, and PUT the
 * result back. Weight and remaining-budget badges come from
 * /api/routing-scheduler-state (Phase 5) polled every 30 s;
 * scenario-mode deployments show "no scheduler data yet" instead.
 *
 * No shadcn Card component (per project convention). Border-left
 * accent + hover:bg-muted/50 for the row treatment.
 */

import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api, type RouterPreferenceEntryWire, type RoutingSchedulerStateResponse } from '@/lib/api'
import type { ShellOutletContext } from './AppShell'

const TIERS = ['fable', 'opus', 'sonnet', 'haiku'] as const
type Tier = (typeof TIERS)[number]

// Available models drawn from the current Config: every provider's
// models rendered as "providerName,modelName" so the target string
// matches what the server expects.
const collectAvailableTargets = (providers: readonly { name: string; models?: readonly string[] }[]): string[] => {
  const out: string[] = []
  for (const p of providers) {
    for (const m of p.models ?? []) out.push(`${p.name},${m}`)
  }
  return out.sort((a, b) => a.localeCompare(b))
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

const SCHEDULER_POLL_MS = 30_000

export function RouterPreferences() {
  const { t } = useTranslation()
  const { config } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [entries, setEntries] = useState<RouterPreferenceEntryWire[]>([])
  const [constraints, setConstraints] = useState<ConstraintsForm>(CONSTRAINT_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scheduler, setScheduler] = useState<RoutingSchedulerStateResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getRouterPreferences()
      .then((p) => {
        if (cancelled) return
        setEntries(p.entries)
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

  // Scheduler-state polling. Skipped when scheduler is degraded /
  // scenario-only — the badge just shows "no data".
  useEffect(() => {
    let cancelled = false
    const fetchOnce = (): void => {
      void api
        .getRoutingSchedulerState()
        .then((s) => {
          if (!cancelled) setScheduler(s)
        })
        .catch(() => {
          /* silent — scheduler API may 404 on older backends */
        })
    }
    fetchOnce()
    const id = setInterval(fetchOnce, SCHEDULER_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const availableTargets = useMemo(() => collectAvailableTargets(config?.Providers ?? []), [config])
  const weightByTarget = useMemo(() => {
    const m = new Map<string, { weight: number; budget: number | null }>()
    for (const w of scheduler?.weights ?? []) {
      m.set(w.target, { weight: w.weight, budget: w.remainingBudgetPct })
    }
    return m
  }, [scheduler])

  const move = useCallback((from: number, to: number) => {
    setEntries((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [pulled] = next.splice(from, 1)
      next.splice(to, 0, pulled)
      return next.map((e, i) => ({ ...e, priority: i + 1 }))
    })
  }, [])

  const remove = useCallback((idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx).map((e, i) => ({ ...e, priority: i + 1 })))
  }, [])

  const setEnabled = useCallback((idx: number, enabled: boolean) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, enabled } : e)))
  }, [])

  const toggleSubagentTier = useCallback((idx: number, tier: Tier) => {
    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== idx) return e
        const has = e.subagentTiers.includes(tier)
        const next = has ? e.subagentTiers.filter((x) => x !== tier) : [...e.subagentTiers, tier]
        return { ...e, subagentTiers: next }
      })
    )
  }, [])

  const [addTarget, setAddTarget] = useState<string>('')
  const addEntry = useCallback(() => {
    if (addTarget === '') return
    setEntries((prev) => {
      if (prev.some((e) => e.target === addTarget)) return prev
      return [...prev, { priority: prev.length + 1, target: addTarget, enabled: true, subagentTiers: [] }]
    })
    setAddTarget('')
  }, [addTarget])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const outcome = await api.putRouterPreferences({
        entries,
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
  }, [entries, constraints, showToast, t])

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

        <section className='space-y-2'>
          <h2 className='font-medium text-sm'>{t('routerPreferences.chain')}</h2>
          <div className='divide-y border-y empty:border-none'>
            {entries.map((entry, idx) => {
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
                    disabled={idx === entries.length - 1}
                  >
                    <ArrowDown className='h-4 w-4' />
                  </Button>
                  <Button size='sm' variant='ghost' onClick={() => remove(idx)}>
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              )
            })}
          </div>

          <div className='flex items-center gap-2 pt-3'>
            <Select value={addTarget} onValueChange={setAddTarget}>
              <SelectTrigger className='flex-1'>
                <SelectValue placeholder={t('routerPreferences.selectModel')} />
              </SelectTrigger>
              <SelectContent>
                {availableTargets
                  .filter((t) => !entries.some((e) => e.target === t))
                  .map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button onClick={addEntry} disabled={addTarget === ''}>
              {t('routerPreferences.addModel')}
            </Button>
          </div>
        </section>

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
