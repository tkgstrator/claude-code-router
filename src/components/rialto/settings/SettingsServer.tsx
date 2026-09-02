/**
 * Settings → Server. The boot-time half of the config envelope.
 *
 * Absorbs the old `SettingsPage`: every scalar here is written to the
 * on-disk config envelope and mirrored onto `process.env`, so a change
 * lands immediately but most of it only takes effect on the next boot —
 * hence the Restart affordance in the heading row rather than a modal
 * after every save.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Pill, RButton } from '@/components/rialto/primitives'
import { SectionHead, StaticField, TextField, ToggleField } from '@/components/rialto/settings/fields'
import { SettingsField, SettingsLayout } from '@/components/rialto/settings/SettingsLayout'
import { api, type HealthResponse } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { fmtAgo } from '@/lib/rialto/format'
import { type EnvelopeWire, maskSecret, parseCount } from '@/lib/rialto/settings/envelope'
import { APP_VERSION } from '@/version'

/** Every editable scalar as text, so a half-typed number never becomes NaN. */
interface ServerDraft {
  HOST: string
  PORT: string
  API_TIMEOUT_MS: string
  PROXY_URL: string
  NON_INTERACTIVE_MODE: boolean
}

const toDraft = (w: EnvelopeWire): ServerDraft => ({
  HOST: typeof w.HOST === 'string' ? w.HOST : '',
  PORT: typeof w.PORT === 'number' ? String(w.PORT) : '',
  API_TIMEOUT_MS: typeof w.API_TIMEOUT_MS === 'number' ? String(w.API_TIMEOUT_MS) : '',
  PROXY_URL: typeof w.PROXY_URL === 'string' ? w.PROXY_URL : '',
  NON_INTERACTIVE_MODE: w.NON_INTERACTIVE_MODE === true
})

interface UpdateState {
  hasUpdate: boolean
  latestVersion?: string
}

function UpdateSection() {
  const { t } = useTranslation()
  const [state, setState] = useState<UpdateState | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [checking, setChecking] = useState(false)

  const check = useCallback(() => {
    setChecking(true)
    api
      .checkForUpdates()
      .then((res) => {
        setState(res)
        setCheckedAt(dayjs().toISOString())
        setNow(Date.now())
      })
      .catch((e: Error) => toast.error(t('settings.server.updateCheckFailed', { message: e.message })))
      .finally(() => setChecking(false))
  }, [t])

  useEffect(check, [check])

  const hint =
    checkedAt === null
      ? t('settings.server.notCheckedYet')
      : t('settings.server.checkedAgo', { ago: fmtAgo(checkedAt, now) })

  return (
    <>
      <SectionHead title={t('settings.server.updateTitle')} />
      <SettingsField label={t('settings.server.version')} hint={hint}>
        <div className='flex items-center gap-3'>
          <span className='font-mono text-xs'>v{APP_VERSION}</span>
          {state === null ? (
            <Pill tone='mute'>{t('settings.server.versionUnknown')}</Pill>
          ) : state.hasUpdate ? (
            <Pill tone='warn'>{t('settings.server.versionAvailable', { version: state.latestVersion })}</Pill>
          ) : (
            <Pill tone='ok'>{t('settings.server.upToDate')}</Pill>
          )}
          <RButton variant='ghost' icon='ri-refresh-line' onClick={check} disabled={checking}>
            {t('settings.server.checkNow')}
          </RButton>
        </div>
      </SettingsField>
    </>
  )
}

const CHECK_TONES = { ok: 'ok', fail: 'bad', skip: 'mute' } as const
const CHECK_LABEL_KEYS = {
  ok: 'settings.server.checkReachable',
  fail: 'settings.server.checkUnreachable',
  skip: 'settings.server.checkNotConfigured'
} as const

function CheckPill({ state }: { state: 'ok' | 'fail' | 'skip' | undefined }) {
  const { t } = useTranslation()
  if (state === undefined) return <Pill tone='mute'>{t('settings.server.checkNotReported')}</Pill>
  return <Pill tone={CHECK_TONES[state]}>{t(CHECK_LABEL_KEYS[state])}</Pill>
}

/**
 * The mock shows the home directory, database and Redis connection
 * strings. `/health` reports whether each dependency answered, which is
 * the part an operator acts on; the URLs themselves never leave the
 * server, so that row says so rather than guessing at a path.
 */
function DataSection() {
  const { t } = useTranslation()
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    api
      .getHealth()
      .then(setHealth)
      .catch(() => {
        // A probe that never answered is not the same claim as a
        // dependency that answered "down", so the rows fall through to
        // "not reported" rather than colouring themselves red.
      })
  }, [])

  return (
    <>
      <SectionHead
        title={t('settings.server.dataTitle')}
        meta={
          health === null
            ? t('settings.server.healthUnavailable')
            : t('settings.server.uptime', { seconds: health.uptime_seconds })
        }
      />
      <StaticField
        label={t('settings.server.homeDirectory')}
        hint={t('settings.server.homeDirectoryHint')}
        value={<span className='text-muted-foreground'>{t('settings.server.serverSideOnly')}</span>}
      />
      <SettingsField label={t('settings.server.database')} hint={t('settings.server.databaseHint')}>
        <CheckPill state={health?.checks.db} />
      </SettingsField>
      <SettingsField label={t('settings.server.redis')} hint={t('settings.server.redisHint')}>
        <CheckPill state={health?.checks.redis} />
      </SettingsField>
    </>
  )
}

function ServerFields({
  draft,
  wire,
  onChange
}: {
  draft: ServerDraft
  wire: EnvelopeWire
  onChange: (next: ServerDraft) => void
}) {
  const { t } = useTranslation()
  const set = <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => onChange({ ...draft, [key]: value })
  return (
    <>
      <TextField
        label={t('settings.server.host')}
        hint={t('settings.server.hostHint')}
        value={draft.HOST}
        onChange={(v) => set('HOST', v)}
        placeholder='127.0.0.1'
      />
      <TextField
        label={t('settings.server.port')}
        value={draft.PORT}
        inputMode='numeric'
        onChange={(v) => set('PORT', v)}
      />
      <StaticField
        label={t('settings.server.bootstrapToken')}
        hint={t('settings.server.bootstrapTokenHint')}
        value={maskSecret(wire.APIKEY)}
      />
      <TextField
        label={t('settings.server.requestTimeout')}
        hint={t('settings.server.requestTimeoutHint')}
        value={draft.API_TIMEOUT_MS}
        inputMode='numeric'
        onChange={(v) => set('API_TIMEOUT_MS', v)}
      />
      <TextField
        label={t('settings.server.proxyUrl')}
        hint={t('settings.server.proxyUrlHint')}
        value={draft.PROXY_URL}
        onChange={(v) => set('PROXY_URL', v)}
        placeholder={t('settings.server.unset')}
      />
      <ToggleField
        label={t('settings.server.nonInteractive')}
        hint={t('settings.server.nonInteractiveHint')}
        value={draft.NON_INTERACTIVE_MODE}
        onChange={(v) => set('NON_INTERACTIVE_MODE', v)}
      />
    </>
  )
}

export function SettingsServer() {
  const { t } = useTranslation()
  const [wire, setWire] = useState<EnvelopeWire | null>(null)
  const [draft, setDraft] = useState<ServerDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    api
      .get<EnvelopeWire>('/config')
      .then((res) => {
        setWire(res)
        setDraft(toDraft(res))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(load, [load])

  const dirty = useMemo(
    () => wire !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(wire)),
    [draft, wire]
  )

  const save = () => {
    if (draft === null) return
    const PORT = parseCount(draft.PORT)
    const API_TIMEOUT_MS = parseCount(draft.API_TIMEOUT_MS)
    if (PORT === null || API_TIMEOUT_MS === null) {
      toast.error(t('settings.server.numbersRequired'))
      return
    }
    setSaving(true)
    api
      .post<{ success: boolean; message: string }>('/config', {
        HOST: draft.HOST,
        PORT,
        API_TIMEOUT_MS,
        PROXY_URL: draft.PROXY_URL,
        NON_INTERACTIVE_MODE: draft.NON_INTERACTIVE_MODE
      })
      .then((res) => {
        toast.success(res.message)
        load()
      })
      .catch((e: Error) => toast.error(t('settings.common.saveFailed', { message: e.message })))
      .finally(() => setSaving(false))
  }

  const restart = () => {
    api
      .restartService()
      .then(() => toast.success(t('settings.server.restartRequested')))
      .catch((e: Error) => toast.error(t('settings.server.restartFailed', { message: e.message })))
  }

  return (
    <SettingsLayout
      active='server'
      title={t('settings.common.title')}
      subtitle={t('settings.server.subtitle', { version: APP_VERSION })}
      headerNote={t('settings.server.headerNote')}
      headerActions={
        <RButton variant='outline' icon='ri-restart-line' onClick={restart}>
          {t('settings.server.restart')}
        </RButton>
      }
      actions={
        <>
          <RButton
            variant='ghost'
            onClick={() => (wire === null ? undefined : setDraft(toDraft(wire)))}
            disabled={!dirty}
          >
            {t('common.discard')}
          </RButton>
          <RButton variant='primary' icon='ri-check-line' onClick={save} disabled={!dirty || saving}>
            {t('common.save')}
          </RButton>
        </>
      }
    >
      {error !== null ? (
        <div className='px-6 py-6 text-xs text-destructive'>{error}</div>
      ) : draft === null || wire === null ? (
        <div className='px-6 py-6 text-xs text-muted-foreground'>{t('common.loading')}</div>
      ) : (
        <ServerFields draft={draft} wire={wire} onChange={setDraft} />
      )}

      <DataSection />
      <UpdateSection />
      <div className='h-10' />
    </SettingsLayout>
  )
}
