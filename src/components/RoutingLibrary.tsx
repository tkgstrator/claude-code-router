/**
 * Routing Library — grid overview of every routing entity.
 *
 * The first cell is always the Live routing (RouterSlot); the rest are
 * saved presets. Clicking a card drills into the editor for that
 * entity. Preset cards carry inline actions (Apply to Live, Rename,
 * Delete) through their kebab popover.
 *
 * Draft model semantics: Apply-to-Live is the ONLY server-side action
 * that touches RouterSlot from this page. Preset CRUD (rename / delete)
 * mutates the preset row only. Opening a preset in the editor and
 * hitting Save persists back to that preset — never to Live.
 */

import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { LiveBadge, RoutingCard } from '@/components/routing-map/RoutingCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, type RoutingPresetItem } from '@/lib/api'
import { applyPresetToLive } from '@/lib/routing-map/apply-to-live'
import { summarizeRouter } from '@/lib/routing-map/summary'
import type { ShellOutletContext } from './AppShell'

// The two shared dialogs the library page owns (name-entry for
// rename/create, plus destructive confirms). Keeping them centralized
// avoids per-card dialog instances (visual noise) and keeps `busy`
// gating in one place.
type NameDialogMode = { kind: 'rename'; preset: RoutingPresetItem } | { kind: 'newPreset' } | null

type ConfirmMode = { kind: 'delete'; preset: RoutingPresetItem } | { kind: 'apply'; preset: RoutingPresetItem } | null

export function RoutingLibrary() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { config, setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()

  const [presets, setPresets] = useState<RoutingPresetItem[]>([])
  const [nameDialog, setNameDialog] = useState<NameDialogMode>(null)
  const [nameInput, setNameInput] = useState('')
  const [confirm, setConfirm] = useState<ConfirmMode>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const { presets: rows } = await api.listRoutingPresets()
      setPresets(rows)
    } catch (err) {
      showToast(`${t('router.presetLoadFailed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [showToast, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const liveSummary = useMemo(() => (config === null ? [] : summarizeRouter(config.Router)), [config])
  const liveCaption = useMemo(() => {
    if (config === null) return null
    const personaId = config.Router.persona
    if (personaId === undefined || personaId === '') return null
    const persona = config.Personas.find((p) => p.id === personaId)
    return persona === undefined ? null : t('router.persona') + ': ' + persona.name
  }, [config, t])

  const openLive = useCallback(() => navigate('/routing-map/live'), [navigate])
  const openPreset = useCallback((id: string) => navigate(`/routing-map/preset/${encodeURIComponent(id)}`), [navigate])

  const startRename = useCallback((preset: RoutingPresetItem) => {
    setNameDialog({ kind: 'rename', preset })
    setNameInput(preset.name)
  }, [])

  const startNewPreset = useCallback(() => {
    setNameDialog({ kind: 'newPreset' })
    setNameInput('')
  }, [])

  const submitName = useCallback(async () => {
    if (nameDialog === null) return
    const trimmed = nameInput.trim()
    if (trimmed.length === 0) return
    setBusy(true)
    try {
      if (nameDialog.kind === 'rename') {
        const updated = await api.updateRoutingPreset(nameDialog.preset.id, { name: trimmed })
        setPresets((rows) => rows.map((r) => (r.id === updated.id ? updated : r)))
        showToast(t('router.presetRenamed', { name: updated.name }), 'success')
      } else if (nameDialog.kind === 'newPreset' && config !== null) {
        // Seed a new preset from the current Live routing so the user
        // has a baseline to edit rather than a blank slate. If they
        // want an empty routing, they can clear it in the editor.
        const created = await api.createRoutingPreset({ name: trimmed, config: config.Router })
        setPresets((rows) => [created, ...rows])
        setNameDialog(null)
        // Jump straight into the editor for the new preset so the
        // typical flow is Create → Edit → Save without extra clicks.
        openPreset(created.id)
        return
      }
      setNameDialog(null)
    } catch (err) {
      showToast(`${t('router.presetSaveFailed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [nameDialog, nameInput, config, openPreset, showToast, t])

  const confirmDelete = useCallback(async () => {
    if (confirm === null || confirm.kind !== 'delete') return
    setBusy(true)
    try {
      await api.deleteRoutingPreset(confirm.preset.id)
      setPresets((rows) => rows.filter((r) => r.id !== confirm.preset.id))
      showToast(t('router.presetDeleted', { name: confirm.preset.name }), 'success')
      setConfirm(null)
    } catch (err) {
      showToast(`${t('router.presetDeleteFailed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [confirm, showToast, t])

  // Apply preset → Live: copy the preset's Router snapshot onto the
  // live config and POST /api/config. Kept behind a confirm because it
  // silently overwrites whatever the user had in RouterSlot.
  const confirmApply = useCallback(async () => {
    if (confirm === null || confirm.kind !== 'apply' || config === null) return
    setBusy(true)
    const result = await applyPresetToLive(config, confirm.preset.config, confirm.preset.name)
    if (result.ok) {
      setConfig(result.updatedConfig)
      showToast(t('router.presetApplied', { name: confirm.preset.name }), 'success')
      setConfirm(null)
    } else {
      showToast(`${t('app.config_saved_failed')}: ${result.message}`, 'error')
    }
    setBusy(false)
  }, [confirm, config, setConfig, showToast, t])

  if (config === null) {
    return (
      <PageContainer>
        <PageHeader title={t('routingMap.title')} />
        <PageContent className='flex items-center justify-center'>
          <div className='text-muted-foreground'>…</div>
        </PageContent>
      </PageContainer>
    )
  }

  const dialogTitle =
    nameDialog === null ? '' : nameDialog.kind === 'rename' ? t('router.presetRename') : t('router.presetNew')

  return (
    <PageContainer>
      <PageHeader title={t('routingMap.title')}>
        <Button onClick={startNewPreset}>
          <Plus className='h-4 w-4' />
          {t('router.presetNew')}
        </Button>
      </PageHeader>
      <PageContent>
        <div className='space-y-6'>
          <p className='text-sm text-muted-foreground'>{t('routingMap.libraryDescription')}</p>
          <div className='rounded border-l-2 border-l-amber-500 bg-amber-500/5 px-3 py-2 text-sm'>
            {t('routingMap.deprecationNotice')}{' '}
            <a href='/router-preferences' className='underline hover:text-primary'>
              {t('routingMap.deprecationLink')}
            </a>
          </div>
          {/* Auto-fill grid mirroring the Personas page — one cell per
              routing at ~28rem so scenario summaries stay readable. */}
          <div className='grid grid-cols-[repeat(auto-fill,minmax(28rem,1fr))] items-start gap-x-6 gap-y-1'>
            <RoutingCard
              title={
                config.LiveRoutingName === undefined || config.LiveRoutingName === ''
                  ? t('router.live')
                  : config.LiveRoutingName
              }
              caption={liveCaption}
              badge={<LiveBadge />}
              summary={liveSummary}
              onOpen={openLive}
              actions={[]}
            />
            {presets.map((preset) => (
              <RoutingCard
                key={preset.id}
                title={preset.name}
                caption={null}
                summary={summarizeRouter(preset.config)}
                onOpen={() => openPreset(preset.id)}
                actions={[
                  {
                    key: 'apply',
                    label: t('router.presetApplyToLive'),
                    onClick: () => setConfirm({ kind: 'apply', preset })
                  },
                  {
                    key: 'rename',
                    label: t('router.presetRename'),
                    onClick: () => startRename(preset)
                  },
                  {
                    key: 'delete',
                    label: t('router.presetDelete'),
                    destructive: true,
                    onClick: () => setConfirm({ kind: 'delete', preset })
                  }
                ]}
              />
            ))}
          </div>
        </div>
      </PageContent>

      <Dialog open={nameDialog !== null} onOpenChange={(o) => !o && setNameDialog(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={t('router.presetNamePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameInput.trim().length > 0) void submitName()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant='ghost' onClick={() => setNameDialog(null)} disabled={busy}>
              {t('app.cancel')}
            </Button>
            <Button onClick={submitName} disabled={busy || nameInput.trim().length === 0}>
              {t('app.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {confirm === null
                ? ''
                : confirm.kind === 'delete'
                  ? t('router.presetDeleteConfirm', { name: confirm.preset.name })
                  : t('router.presetApplyConfirm', { name: confirm.preset.name })}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant='ghost' onClick={() => setConfirm(null)} disabled={busy}>
              {t('app.cancel')}
            </Button>
            {confirm !== null && confirm.kind === 'delete' ? (
              <Button variant='destructive' onClick={confirmDelete} disabled={busy}>
                {t('router.presetDelete')}
              </Button>
            ) : (
              <Button onClick={confirmApply} disabled={busy}>
                {t('router.presetApplyToLive')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
