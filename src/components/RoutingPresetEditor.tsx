/**
 * Preset routing editor — same React Flow surface as the Live editor,
 * but Save writes back to the RoutingPreset row rather than RouterSlot.
 * Draft model: mutating a preset here NEVER changes the live routing;
 * "Apply to Live" (on the header or the library card) is the only path
 * from a preset to actual traffic.
 */

import { ArrowLeft, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { RoutingEditor } from '@/components/RoutingEditor'
import { RenameControl } from '@/components/routing-map/RenameControl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, type RoutingPresetItem } from '@/lib/api'
import { applyPresetToLive } from '@/lib/routing-map/apply-to-live'
import type { RouterConfig } from '@/schemas'
import type { ShellOutletContext } from './AppShell'

export function RoutingPresetEditor() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { config, setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()

  const [preset, setPreset] = useState<RoutingPresetItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  // Snapshot the latest draft the editor emits — the "Apply to Live"
  // button needs the current in-editor state, not the last-saved
  // snapshot, so the user sees exactly what they applied.
  const [currentDraft, setCurrentDraft] = useState<RouterConfig | null>(null)
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    if (id === undefined) {
      setError('missing preset id')
      return
    }
    const cancel = { current: false }
    void loadPreset(id, t('router.presetNotFound')).then((result) => {
      if (cancel.current) return
      if (result.ok) {
        setPreset(result.preset)
        setCurrentDraft(result.preset.config)
      } else {
        setError(result.message)
      }
    })
    return () => {
      cancel.current = true
    }
  }, [id, t])

  const onSave = useCallback(
    async (router: RouterConfig) => {
      if (preset === null) return { ok: false, message: 'preset not loaded' }
      try {
        const updated = await api.updateRoutingPreset(preset.id, { config: router })
        setPreset(updated)
        setCurrentDraft(updated.config)
        return { ok: true, message: t('router.presetSaved', { name: updated.name }) }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [preset, t]
  )

  const onRename = useCallback(
    async (name: string) => {
      if (preset === null) return
      setRenaming(true)
      try {
        const updated = await api.updateRoutingPreset(preset.id, { name })
        setPreset(updated)
        showToast(t('router.presetRenamed', { name: updated.name }), 'success')
      } catch (err) {
        showToast(`${t('router.presetSaveFailed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        setRenaming(false)
      }
    },
    [preset, showToast, t]
  )

  // Editor doesn't call this on every keystroke — we can't hook into
  // its internal state directly. Instead, refresh currentDraft on save
  // (above) and provide "Apply to Live" as "apply what's currently
  // saved on this preset", not "apply the unsaved draft". That
  // matches the Draft model: unsaved changes shouldn't leak into Live.
  const doApply = useCallback(async () => {
    if (preset === null || config === null || currentDraft === null) return
    setApplying(true)
    const result = await applyPresetToLive(config, currentDraft, preset.name)
    if (result.ok) {
      setConfig(result.updatedConfig)
      showToast(t('router.presetApplied', { name: preset.name }), 'success')
      setApplyConfirmOpen(false)
      navigate('/routing-map')
    } else {
      showToast(`${t('app.config_saved_failed')}: ${result.message}`, 'error')
    }
    setApplying(false)
  }, [preset, config, currentDraft, setConfig, showToast, t, navigate])

  if (error !== null) {
    return (
      <PageContainer>
        <PageHeader fluid title={t('router.preset')} leading={<BackLink label={t('routingMap.backToLibrary')} />} />
        <PageContent className='flex items-center justify-center'>
          <div className='text-sm text-destructive'>{error}</div>
        </PageContent>
      </PageContainer>
    )
  }

  if (preset === null || config === null) {
    return (
      <PageContainer>
        <PageHeader fluid title={t('router.preset')} leading={<BackLink label={t('routingMap.backToLibrary')} />} />
        <PageContent className='flex items-center justify-center'>
          <div className='text-muted-foreground'>…</div>
        </PageContent>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader fluid title={preset.name} leading={<BackLink label={t('routingMap.backToLibrary')} />}>
        <RenameControl currentName={preset.name} onRename={onRename} disabled={renaming} />
        <Button variant='outline' size='sm' onClick={() => setApplyConfirmOpen(true)}>
          <Zap className='h-3.5 w-3.5' />
          {t('router.presetApplyToLive')}
        </Button>
      </PageHeader>
      <RoutingEditor initialRouter={preset.config} onSave={onSave} editable />

      <Dialog open={applyConfirmOpen} onOpenChange={setApplyConfirmOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('router.presetApplyConfirm', { name: preset.name })}</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>{t('router.presetApplyConfirmHint')}</p>
          <DialogFooter>
            <Button variant='ghost' onClick={() => setApplyConfirmOpen(false)} disabled={applying}>
              {t('app.cancel')}
            </Button>
            <Button onClick={doApply} disabled={applying}>
              {t('router.presetApplyToLive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

// Fetch a preset by id from the list endpoint. Returns a
// discriminated result so the effect stays flat (no nested try/catch
// or nullable-branch tangles). notFoundMessage is passed in so i18n
// stays outside the helper.
async function loadPreset(
  id: string,
  notFoundMessage: string
): Promise<{ ok: true; preset: RoutingPresetItem } | { ok: false; message: string }> {
  try {
    const { presets } = await api.listRoutingPresets()
    const found = presets.find((p) => p.id === id)
    if (found === undefined) return { ok: false, message: notFoundMessage }
    return { ok: true, preset: found }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function BackLink({ label }: { label: string }) {
  return (
    <Button asChild variant='ghost' size='sm' className='-ml-2 h-8 px-2'>
      <Link to='/routing-map' aria-label={label}>
        <ArrowLeft className='h-4 w-4' />
      </Link>
    </Button>
  )
}
