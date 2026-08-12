/**
 * Tier Editor dialog.
 *
 * Bulk-edit `Model.manualTier` across every configured provider.
 * When set the value overrides the name-substring tier inference the
 * preference selector uses, so operators can classify third-party
 * models (gpt-5.6-*, gemini-*, ...) as one of fable / opus / sonnet /
 * haiku so tier-respect constraints match.
 *
 * Save PATCHes just the changed rows (compared against the initial
 * snapshot on open); untouched models stay put with a single network
 * roundtrip per changed entry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { Provider } from '@/schemas'

type Tier = 'fable' | 'opus' | 'sonnet' | 'haiku'
type TierValue = Tier | 'auto'
const TIER_OPTIONS: readonly TierValue[] = ['auto', 'fable', 'opus', 'sonnet', 'haiku']

// Name-inference fallback (mirrors tierOf() in the router). Used only
// for the "auto → resolved as" hint next to the select so users can
// see what the fallback would produce.
const inferTier = (name: string): Tier | null => {
  const lower = name.toLowerCase()
  if (lower.includes('fable')) return 'fable'
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return null
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  providers: readonly Provider[]
}

interface Row {
  providerName: string
  modelName: string
  initial: TierValue
  current: TierValue
  inferred: Tier | null
}

const toTierValue = (raw: string | undefined): TierValue => {
  if (raw === 'fable' || raw === 'opus' || raw === 'sonnet' || raw === 'haiku') return raw
  return 'auto'
}

const buildRows = (providers: readonly Provider[]): Row[] => {
  const out: Row[] = []
  for (const p of providers) {
    const overrides = p.modelManualTiers ?? {}
    for (const m of [...p.models].sort((a, b) => a.localeCompare(b))) {
      const v = toTierValue(overrides[m])
      out.push({ providerName: p.name, modelName: m, initial: v, current: v, inferred: inferTier(m) })
    }
  }
  return out
}

export function TierEditor({ open, onOpenChange, providers }: Props) {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [rows, setRows] = useState<Row[]>(() => buildRows(providers))
  const [saving, setSaving] = useState(false)

  // Re-seed when the dialog re-opens so unsaved edits don't linger.
  useEffect(() => {
    if (open) setRows(buildRows(providers))
  }, [open, providers])

  const rowsByProvider = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows) {
      const list = m.get(r.providerName)
      if (list === undefined) m.set(r.providerName, [r])
      else list.push(r)
    }
    return m
  }, [rows])

  const dirtyCount = useMemo(() => rows.filter((r) => r.current !== r.initial).length, [rows])

  const setRowTier = useCallback((provider: string, model: string, next: TierValue) => {
    setRows((prev) =>
      prev.map((r) => (r.providerName === provider && r.modelName === model ? { ...r, current: next } : r))
    )
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    const changed = rows.filter((r) => r.current !== r.initial)
    const outcomes: { row: Row; ok: boolean; err?: string }[] = []
    try {
      for (const r of changed) {
        const manualTier = r.current === 'auto' ? null : r.current
        try {
          await api.setModelTier(r.providerName, r.modelName, manualTier)
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
      // Reset baseline for successful rows so a repeat save is a no-op.
      setRows((prev) =>
        prev.map((r) => {
          const outcome = outcomes.find((o) => o.row.providerName === r.providerName && o.row.modelName === r.modelName)
          return outcome?.ok ? { ...r, initial: r.current } : r
        })
      )
      if (failed.length === 0) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }, [rows, showToast, t, onOpenChange])

  const providersOrdered = useMemo(() => [...rowsByProvider.keys()], [rowsByProvider])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl max-h-[80vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle>{t('tierEditor.title')}</DialogTitle>
          <DialogDescription>{t('tierEditor.description')}</DialogDescription>
        </DialogHeader>
        <div className='flex-1 overflow-y-auto space-y-4'>
          {providersOrdered.map((provider) => (
            <section key={provider} className='space-y-1'>
              <h3 className='sticky top-0 bg-background py-1 font-medium text-sm'>{provider}</h3>
              <div className='divide-y border-y'>
                {(rowsByProvider.get(provider) ?? []).map((r) => (
                  <div
                    key={`${r.providerName}:${r.modelName}`}
                    className='flex items-center gap-3 border-l-2 border-l-transparent px-2 py-2 transition-colors hover:border-l-primary hover:bg-muted/50'
                  >
                    <span className='flex-1 truncate font-medium text-sm'>{r.modelName}</span>
                    {r.current === 'auto' && (
                      <span className='text-muted-foreground text-xs'>
                        {r.inferred === null
                          ? t('tierEditor.inferredNone')
                          : t('tierEditor.inferredAs', { tier: r.inferred })}
                      </span>
                    )}
                    {r.current !== r.initial && (
                      <span className='rounded bg-primary/10 px-1.5 py-0.5 text-primary text-xs'>
                        {t('tierEditor.dirty')}
                      </span>
                    )}
                    <Select
                      value={r.current}
                      onValueChange={(v) =>
                        setRowTier(r.providerName, r.modelName, v === 'auto' ? 'auto' : (v as Tier))
                      }
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
                  </div>
                ))}
              </div>
            </section>
          ))}
          {providersOrdered.length === 0 && (
            <div className='py-6 text-sm text-muted-foreground'>{t('tierEditor.empty')}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)} disabled={saving}>
            {t('app.cancel')}
          </Button>
          <Button onClick={save} disabled={saving || dirtyCount === 0}>
            {saving
              ? t('app.saving')
              : dirtyCount > 0
                ? t('tierEditor.saveWithCount', { count: dirtyCount })
                : t('app.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
