/**
 * Tier + reasoning-effort override editor page.
 *
 * Bulk-edit `Model.manualTier` and `Model.reasoningEffort` across every
 * configured provider. Tier feeds the quota-aware preference selector's
 * tier-respect constraint; reasoning-effort is injected into the outgoing
 * OpenAI / OpenAI-Responses request at build time (gpt-5.x / o-series
 * only — other model families ignore the field).
 *
 * Save PATCHes just the changed rows (compared against the initial
 * snapshot on load); untouched models stay put with a single network
 * roundtrip per changed entry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { Provider } from '@/schemas'
import { REASONING_MODEL_RE } from '@/shared/constants'

type Tier = 'fable' | 'opus' | 'sonnet' | 'haiku'
type TierValue = Tier | 'auto'
type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type EffortValue = Effort | 'auto'

const TIER_OPTIONS: readonly TierValue[] = ['auto', 'fable', 'opus', 'sonnet', 'haiku']
const EFFORT_OPTIONS: readonly EffortValue[] = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

// Same guard the server-side OpenAI transformer uses to decide whether
// to emit `reasoning_effort` (gpt-5.x and o1/o3/o4 chat models); we grey
// out the selector for anything else so operators don't set a value the
// vendor will silently ignore. Regex lives in @/shared/constants so the
// server and frontend stay in lock-step.
const supportsReasoningEffort = (model: string): boolean => REASONING_MODEL_RE.test(model)

interface Row {
  providerName: string
  modelName: string
  initialTier: TierValue
  currentTier: TierValue
  initialEffort: EffortValue
  currentEffort: EffortValue
  supportsEffort: boolean
}

const toTierValue = (raw: string | undefined): TierValue => {
  if (raw === 'fable' || raw === 'opus' || raw === 'sonnet' || raw === 'haiku') return raw
  return 'auto'
}

const toEffortValue = (raw: string | undefined): EffortValue => {
  if (
    raw === 'none' ||
    raw === 'minimal' ||
    raw === 'low' ||
    raw === 'medium' ||
    raw === 'high' ||
    raw === 'xhigh' ||
    raw === 'max'
  ) {
    return raw
  }
  return 'auto'
}

// Mirror the essential "enabled" gate that ModelsDashboard applies:
// skip providers turned off in config and models the user disabled
// via the transformer._disabledModels list. The subscription-plan
// check is deliberately omitted here — a tier assignment survives even
// while a subscription is being (re)configured, so we keep the row.
const buildRows = (providers: readonly Provider[]): Row[] => {
  const out: Row[] = []
  for (const p of providers) {
    if (p.enabled === false) continue
    const disabled = new Set(p.transformer?._disabledModels ?? [])
    const tierMap = p.modelManualTiers ?? {}
    const effortMap = p.modelReasoningEfforts ?? {}
    for (const m of [...p.models].sort((a, b) => a.localeCompare(b))) {
      if (disabled.has(m)) continue
      out.push({
        providerName: p.name,
        modelName: m,
        initialTier: toTierValue(tierMap[m]),
        currentTier: toTierValue(tierMap[m]),
        initialEffort: toEffortValue(effortMap[m]),
        currentEffort: toEffortValue(effortMap[m]),
        supportsEffort: supportsReasoningEffort(m)
      })
    }
  }
  return out
}

export function TierEditor() {
  const { t } = useTranslation()
  const { config } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const providers = useMemo(() => config?.Providers ?? [], [config])
  const [rows, setRows] = useState<Row[]>(() => buildRows(providers))
  const [saving, setSaving] = useState(false)

  // Re-seed whenever the config-provided list changes so an external
  // /api/config update (e.g. a Providers save on another tab) drops
  // any stale rows without leaving edits from a deleted row behind.
  useEffect(() => {
    setRows(buildRows(providers))
  }, [providers])

  const rowsByProvider = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows) {
      const list = m.get(r.providerName)
      if (list === undefined) m.set(r.providerName, [r])
      else list.push(r)
    }
    return m
  }, [rows])

  const isDirty = useCallback((r: Row) => r.currentTier !== r.initialTier || r.currentEffort !== r.initialEffort, [])
  const dirtyCount = useMemo(() => rows.filter(isDirty).length, [rows, isDirty])

  const setRowTier = useCallback((provider: string, model: string, next: TierValue) => {
    setRows((prev) =>
      prev.map((r) => (r.providerName === provider && r.modelName === model ? { ...r, currentTier: next } : r))
    )
  }, [])

  const setRowEffort = useCallback((provider: string, model: string, next: EffortValue) => {
    setRows((prev) =>
      prev.map((r) => (r.providerName === provider && r.modelName === model ? { ...r, currentEffort: next } : r))
    )
  }, [])

  const resetChanges = useCallback(() => {
    setRows((prev) => prev.map((r) => ({ ...r, currentTier: r.initialTier, currentEffort: r.initialEffort })))
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    const changed = rows.filter(isDirty)
    const outcomes: { row: Row; ok: boolean; err?: string }[] = []
    try {
      for (const r of changed) {
        try {
          if (r.currentTier !== r.initialTier) {
            const manualTier = r.currentTier === 'auto' ? null : r.currentTier
            await api.setModelTier(r.providerName, r.modelName, manualTier)
          }
          if (r.currentEffort !== r.initialEffort) {
            const effort = r.currentEffort === 'auto' ? null : r.currentEffort
            await api.setModelReasoningEffort(r.providerName, r.modelName, effort)
          }
          outcomes.push({ row: r, ok: true })
        } catch (err) {
          outcomes.push({ row: r, ok: false, err: err instanceof Error ? err.message : String(err) })
        }
      }
      const failed = outcomes.filter((o) => !o.ok)
      if (failed.length === 0) {
        showToast(t('tierEditor.saved', { count: outcomes.length }), 'success')
      } else {
        for (const f of failed) {
          showToast(
            `${t('tierEditor.saveOneFailed', { target: `${f.row.providerName},${f.row.modelName}` })}: ${f.err ?? ''}`,
            'error'
          )
        }
      }
      setRows((prev) =>
        prev.map((r) => {
          const outcome = outcomes.find((o) => o.row.providerName === r.providerName && o.row.modelName === r.modelName)
          return outcome?.ok ? { ...r, initialTier: r.currentTier, initialEffort: r.currentEffort } : r
        })
      )
    } finally {
      setSaving(false)
    }
  }, [rows, showToast, t, isDirty])

  const providersOrdered = useMemo(() => [...rowsByProvider.keys()], [rowsByProvider])

  return (
    <PageContainer>
      <PageHeader title={t('tierEditor.title')}>
        <Button variant='ghost' onClick={resetChanges} disabled={dirtyCount === 0 || saving}>
          {t('app.cancel')}
        </Button>
        <Button onClick={save} disabled={saving || dirtyCount === 0}>
          {saving
            ? t('app.saving')
            : dirtyCount > 0
              ? t('tierEditor.saveWithCount', { count: dirtyCount })
              : t('app.save')}
        </Button>
      </PageHeader>
      <PageContent className='space-y-4'>
        <p className='text-muted-foreground text-sm'>{t('tierEditor.description')}</p>
        {providersOrdered.map((provider) => (
          <section key={provider} className='space-y-1'>
            <h3 className='sticky top-0 z-10 bg-background py-1 font-medium text-sm'>{provider}</h3>
            <div className='divide-y border-y'>
              {(rowsByProvider.get(provider) ?? []).map((r) => (
                <div
                  key={`${r.providerName}:${r.modelName}`}
                  className='flex items-center gap-3 border-l-2 border-l-transparent px-3 py-2 transition-colors hover:border-l-primary hover:bg-muted/50'
                >
                  <span className='flex-1 truncate font-medium text-sm'>{r.modelName}</span>
                  {isDirty(r) && (
                    <span className='rounded bg-primary/10 px-1.5 py-0.5 text-primary text-xs'>
                      {t('tierEditor.dirty')}
                    </span>
                  )}
                  <Select
                    value={r.currentTier}
                    onValueChange={(v) => setRowTier(r.providerName, r.modelName, v === 'auto' ? 'auto' : (v as Tier))}
                  >
                    <SelectTrigger className='w-28'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIER_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt === 'auto' ? t('tierEditor.auto') : opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={r.currentEffort}
                    disabled={!r.supportsEffort}
                    onValueChange={(v) =>
                      setRowEffort(r.providerName, r.modelName, v === 'auto' ? 'auto' : (v as Effort))
                    }
                  >
                    <SelectTrigger
                      className='w-28'
                      title={r.supportsEffort ? undefined : t('tierEditor.effortUnsupported')}
                    >
                      <SelectValue placeholder={t('tierEditor.effortPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {EFFORT_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt === 'auto' ? t('tierEditor.auto') : opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </section>
        ))}
        {providersOrdered.length === 0 && (
          <div className='py-6 text-sm text-muted-foreground'>{t('tierEditor.empty')}</div>
        )}
      </PageContent>
    </PageContainer>
  )
}
