/**
 * Live routing editor — drives RouterSlot directly. Same React Flow
 * editor as the preset editor, but Save routes to /api/config so the
 * change is what actually routes traffic. Back link takes the user to
 * the Routing Library grid.
 */

import { ArrowLeft } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useOutletContext } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { RoutingEditor } from '@/components/RoutingEditor'
import { RenameControl } from '@/components/routing-map/RenameControl'
import { LiveBadge } from '@/components/routing-map/RoutingCard'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { RouterConfig } from '@/schemas'
import type { ShellOutletContext } from './AppShell'

// Interpret the /api/config response — same shape as the old inline
// helper in RoutingEditor. Missing `success` means "no explicit
// failure signal" → treat as ok.
function readSaveResult(res: unknown): { ok: boolean; message: string | undefined } {
  if (typeof res !== 'object' || res === null) return { ok: true, message: undefined }
  const ok = 'success' in res ? res.success === true : true
  const message = 'message' in res && typeof res.message === 'string' ? res.message : undefined
  return { ok, message }
}

export function RoutingLiveEditor() {
  const { t } = useTranslation()
  const { config, setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [renaming, setRenaming] = useState(false)

  const onSave = useCallback(
    async (router: RouterConfig) => {
      if (config === null) return { ok: false, message: t('app.config_saved_failed') }
      const updated = { ...config, Router: router }
      setConfig(updated)
      const result = readSaveResult(await api.updateConfig(updated))
      return { ok: result.ok, message: result.message }
    },
    [config, setConfig, t]
  )

  const onRename = useCallback(
    async (name: string) => {
      if (config === null) return
      setRenaming(true)
      try {
        // Send only the LiveRoutingName field — splitPayload folds
        // catchall keys straight into the envelope, so this is a
        // one-key write that doesn't touch Providers/Router/etc.
        await api.updateConfig({ ...config, LiveRoutingName: name })
        setConfig({ ...config, LiveRoutingName: name })
        showToast(t('router.liveRenamed', { name }), 'success')
      } catch (err) {
        showToast(`${t('app.config_saved_failed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        setRenaming(false)
      }
    },
    [config, setConfig, showToast, t]
  )

  if (config === null) return null

  const liveName =
    config.LiveRoutingName === undefined || config.LiveRoutingName === '' ? t('router.live') : config.LiveRoutingName

  return (
    <PageContainer>
      <PageHeader
        fluid
        title={liveName}
        leading={
          <Button asChild variant='ghost' size='sm' className='-ml-2 h-8 px-2'>
            <Link to='/routing-map' aria-label={t('routingMap.backToLibrary')}>
              <ArrowLeft className='h-4 w-4' />
            </Link>
          </Button>
        }
      >
        <RenameControl currentName={liveName} onRename={onRename} disabled={renaming} />
        <LiveBadge />
      </PageHeader>
      <RoutingEditor initialRouter={config.Router} onSave={onSave} editable />
    </PageContainer>
  )
}
