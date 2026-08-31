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
      .catch((e: Error) => toast.error(`Update check failed: ${e.message}`))
      .finally(() => setChecking(false))
  }, [])

  useEffect(check, [check])

  const hint = checkedAt === null ? 'Not checked yet' : `Checked ${fmtAgo(checkedAt, now)} ago`

  return (
    <>
      <SectionHead title='Update' />
      <SettingsField label='Version' hint={hint}>
        <div className='flex items-center gap-3'>
          <span className='font-mono text-xs'>v{APP_VERSION}</span>
          {state === null ? (
            <Pill tone='mute'>unknown</Pill>
          ) : state.hasUpdate ? (
            <Pill tone='warn'>v{state.latestVersion} available</Pill>
          ) : (
            <Pill tone='ok'>up to date</Pill>
          )}
          <RButton variant='ghost' icon='ri-refresh-line' onClick={check} disabled={checking}>
            Check now
          </RButton>
        </div>
      </SettingsField>
    </>
  )
}

const CHECK_TONES = { ok: 'ok', fail: 'bad', skip: 'mute' } as const
const CHECK_LABELS = { ok: 'reachable', fail: 'unreachable', skip: 'not configured' } as const

function CheckPill({ state }: { state: 'ok' | 'fail' | 'skip' | undefined }) {
  if (state === undefined) return <Pill tone='mute'>not reported</Pill>
  return <Pill tone={CHECK_TONES[state]}>{CHECK_LABELS[state]}</Pill>
}

/**
 * The mock shows the home directory, database and Redis connection
 * strings. `/health` reports whether each dependency answered, which is
 * the part an operator acts on; the URLs themselves never leave the
 * server, so that row says so rather than guessing at a path.
 */
function DataSection() {
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
      <SectionHead title='Data' meta={health === null ? 'health probe unavailable' : `up ${health.uptime_seconds}s`} />
      <StaticField
        label='Home directory'
        hint='Config envelope, plugins, tokenizer cache. Not surfaced by the API.'
        value={<span className='text-muted-foreground'>server-side only</span>}
      />
      <SettingsField label='Database' hint='Providers, models, routing, sessions, usage.'>
        <CheckPill state={health?.checks.db} />
      </SettingsField>
      <SettingsField label='Redis' hint='Usage capture + auth-health job queue.'>
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
  const set = <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => onChange({ ...draft, [key]: value })
  return (
    <>
      <TextField
        label='Host'
        hint='Bind address. Set a bootstrap token before exposing beyond loopback.'
        value={draft.HOST}
        onChange={(v) => set('HOST', v)}
        placeholder='127.0.0.1'
      />
      <TextField label='Port' value={draft.PORT} inputMode='numeric' onChange={(v) => set('PORT', v)} />
      <StaticField
        label='Bootstrap token'
        hint='Gates /api/* and /v1/*. Minted on first run. Reveal and copy it under Access.'
        value={maskSecret(wire.APIKEY)}
      />
      <TextField
        label='Request timeout'
        hint='Milliseconds. Applies to every upstream call.'
        value={draft.API_TIMEOUT_MS}
        inputMode='numeric'
        onChange={(v) => set('API_TIMEOUT_MS', v)}
      />
      <TextField
        label='Proxy URL'
        hint='Routes upstream traffic through an HTTPS proxy.'
        value={draft.PROXY_URL}
        onChange={(v) => set('PROXY_URL', v)}
        placeholder='unset'
      />
      <ToggleField
        label='Non-interactive'
        hint='Skip prompts that expect a TTY.'
        value={draft.NON_INTERACTIVE_MODE}
        onChange={(v) => set('NON_INTERACTIVE_MODE', v)}
      />
    </>
  )
}

export function SettingsServer() {
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
      toast.error('Port and request timeout must be whole numbers.')
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
      .catch((e: Error) => toast.error(`Save failed: ${e.message}`))
      .finally(() => setSaving(false))
  }

  const restart = () => {
    api
      .restartService()
      .then(() => toast.success('Restart requested.'))
      .catch((e: Error) => toast.error(`Restart failed: ${e.message}`))
  }

  return (
    <SettingsLayout
      active='server'
      title='Settings'
      subtitle={`Rialto v${APP_VERSION} · config envelope on disk`}
      headerNote='Boot-time values. A change needs a restart.'
      headerActions={
        <RButton variant='outline' icon='ri-restart-line' onClick={restart}>
          Restart
        </RButton>
      }
      actions={
        <>
          <RButton
            variant='ghost'
            onClick={() => (wire === null ? undefined : setDraft(toDraft(wire)))}
            disabled={!dirty}
          >
            Discard
          </RButton>
          <RButton variant='primary' icon='ri-check-line' onClick={save} disabled={!dirty || saving}>
            Save
          </RButton>
        </>
      }
    >
      {error !== null ? (
        <div className='px-6 py-6 text-xs text-destructive'>{error}</div>
      ) : draft === null || wire === null ? (
        <div className='px-6 py-6 text-xs text-muted-foreground'>Loading…</div>
      ) : (
        <ServerFields draft={draft} wire={wire} onChange={setDraft} />
      )}

      <DataSection />
      <UpdateSection />
      <div className='h-10' />
    </SettingsLayout>
  )
}
