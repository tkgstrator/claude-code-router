/**
 * Settings → Presets.
 *
 * Absorbs `Presets` and its six dialogs. Install used to be a form inside
 * a dialog inside a dialog, and Apply asked for confirmation without ever
 * naming what it would overwrite. Here the library is a column, the
 * preset's own inputs render inline, and the apply diff is on screen
 * before the operator commits.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfig } from '@/components/ConfigProvider'
import { RButton } from '@/components/rialto/primitives'
import { api } from '@/lib/api'
import type { MarketPreset, PresetDetail, PresetMetadata } from '@/lib/presets/types'
import { missingInputIds, seedInputs } from '@/lib/rialto/settings-content/presets'
import type { Config } from '@/types'
import { PresetList, type PresetTab } from './presets/PresetList'
import { PresetPane } from './presets/PresetPane'
import { SettingsLayout } from './SettingsLayout'

interface InstalledResponse {
  presets: PresetMetadata[]
}

interface MarketResponse {
  presets: MarketPreset[]
}

interface ApplyResponse {
  success?: boolean
}

interface InstallResponse {
  presetName?: string
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function PresetsBrowser({ config }: { config: Config }) {
  const [params] = useSearchParams()
  const tab: PresetTab = params.get('tab') === 'market' ? 'market' : 'installed'

  const [installed, setInstalled] = useState<PresetMetadata[]>([])
  const [market, setMarket] = useState<MarketPreset[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PresetDetail | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [storedIds, setStoredIds] = useState<string[]>([])
  const [installOpen, setInstallOpen] = useState(false)
  const [installRepo, setInstallRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadInstalled = useCallback(() => {
    api
      .get<InstalledResponse>('/presets')
      .then((res) => {
        setInstalled(res.presets)
        setError(null)
      })
      .catch((err: unknown) => setError(errorText(err)))
  }, [])

  useEffect(loadInstalled, [loadInstalled])

  useEffect(() => {
    if (tab !== 'market') return
    api
      .get<MarketResponse>('/presets/market')
      .then((res) => setMarket(res.presets))
      .catch((err: unknown) => setError(errorText(err)))
  }, [tab])

  // The list endpoint carries metadata only; the manifest (its input
  // schema and the config it would write) needs a second fetch.
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null)
      return
    }
    api
      .get<PresetDetail>(`/presets/${encodeURIComponent(selectedId)}`)
      .then((res) => {
        setDetail(res)
        const seeded = seedInputs(res.schema === undefined ? [] : res.schema, res.userValues)
        setValues(seeded.values)
        setStoredIds(seeded.storedIds)
      })
      .catch((err: unknown) => setError(errorText(err)))
  }, [selectedId])

  const install = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.post<InstallResponse>('/presets/install/github', { repo: installRepo })
      setInstallOpen(false)
      setInstallRepo('')
      loadInstalled()
      if (res.presetName !== undefined) setSelectedId(res.presetName)
      toast.success('Preset installed')
    } catch (err) {
      toast.error(`Install failed: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }, [installRepo, loadInstalled])

  const apply = useCallback(async () => {
    if (detail === null) return
    const schema = detail.schema === undefined ? [] : detail.schema
    const missing = missingInputIds(schema, values, storedIds)
    if (missing.length > 0) {
      toast.warning(`Fill in ${missing.join(', ')} before applying.`)
      return
    }
    setBusy(true)
    try {
      await api.post<ApplyResponse>(`/presets/${encodeURIComponent(detail.id)}/apply`, { secrets: values })
      toast.success(`${detail.name} applied`)
      loadInstalled()
    } catch (err) {
      toast.error(`Apply failed: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }, [detail, values, storedIds, loadInstalled])

  const remove = useCallback(async () => {
    if (detail === null) return
    setBusy(true)
    try {
      await api.deletePreset(detail.id)
      setSelectedId(null)
      loadInstalled()
      toast.success(`${detail.name} deleted`)
    } catch (err) {
      toast.error(`Delete failed: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }, [detail, loadInstalled])

  const isInstalled = detail !== null && installed.some((p) => p.id === detail.id)
  const subtitle =
    detail === null ? `${installed.length} installed` : `${installed.length} installed · ${detail.name} selected`

  return (
    <SettingsLayout
      active='presets'
      title='Presets'
      subtitle={subtitle}
      // The library column opens on its own tab strip, exactly the case
      // the frame hides its heading for.
      showHeading={false}
      actions={
        <>
          <RButton
            variant='ghost'
            icon='ri-arrow-go-back-line'
            disabled
            title='No revert endpoint yet — save your routing from Routing → Library before applying.'
          >
            Revert last apply
          </RButton>
          <RButton variant='primary' icon='ri-check-line' onClick={apply} disabled={detail === null || busy}>
            Apply
          </RButton>
        </>
      }
    >
      <div className='grid h-full grid-cols-[17rem_1fr]'>
        <PresetList
          tab={tab}
          installed={installed}
          market={market}
          selectedId={selectedId}
          installRepo={installRepo}
          installOpen={installOpen}
          installing={busy}
          onSelect={setSelectedId}
          onOpenInstall={() => setInstallOpen((prev) => !prev)}
          onInstallRepoChange={setInstallRepo}
          onInstall={install}
        />
        {detail === null ? (
          <div className='min-w-0 px-6 py-6 text-xs'>
            {error === null ? (
              <span className='text-muted-foreground'>Select a preset to see what applying it would change.</span>
            ) : (
              <span className='text-destructive'>{error}</span>
            )}
          </div>
        ) : (
          <PresetPane
            preset={detail}
            installed={isInstalled}
            config={config}
            values={values}
            storedIds={storedIds}
            onChange={(id, value) => setValues((prev) => ({ ...prev, [id]: value }))}
            onReapply={apply}
            onDelete={remove}
          />
        )}
      </div>
    </SettingsLayout>
  )
}

export function SettingsPresets() {
  const { config } = useConfig()
  if (config === null) {
    return (
      <SettingsLayout active='presets' title='Presets' showHeading={false}>
        <div className='px-6 py-6 text-xs text-muted-foreground'>Loading…</div>
      </SettingsLayout>
    )
  }
  return <PresetsBrowser config={config} />
}
