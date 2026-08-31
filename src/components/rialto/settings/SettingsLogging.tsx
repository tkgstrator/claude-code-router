/**
 * Settings → Logging. What the server writes down, and how long it keeps it.
 *
 * All three of the mock's groups are real envelope or archive state:
 * the pino sink (LOG / LOG_LEVEL / LOG_MAX_MB), what the archive is
 * allowed to keep (CAPTURE_REQUESTS / CAPTURE_MESSAGES /
 * REDACT_TOOL_ARGUMENTS), and the store sizes behind `GET /api/storage`.
 *
 * The capture keys are read per request rather than at boot, so a save
 * here stops a recording already in flight — which is the situation an
 * operator reaches for this switch in.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { RButton } from '@/components/rialto/primitives'
import { SectionHead, SelectField, StaticField, TextField, ToggleField } from '@/components/rialto/settings/fields'
import {
  RetentionTable,
  type StorageStats,
  type StoreId,
  type StoreStats
} from '@/components/rialto/settings/logging/RetentionTable'
import { WarnNotice } from '@/components/rialto/settings/notice'
import { SettingsLayout } from '@/components/rialto/settings/SettingsLayout'
import { api } from '@/lib/api'
import {
  captureSettings,
  DEFAULT_LOG_MAX_MB,
  type EnvelopeWire,
  fmtBytes,
  LOG_LEVELS,
  parseCount,
  totalBytes
} from '@/lib/rialto/settings/envelope'

interface LoggingDraft {
  LOG: boolean
  LOG_LEVEL: string
  LOG_MAX_MB: string
  CAPTURE_REQUESTS: boolean
  CAPTURE_MESSAGES: boolean
  REDACT_TOOL_ARGUMENTS: boolean
}

const toDraft = (w: EnvelopeWire): LoggingDraft => ({
  LOG: w.LOG === true,
  LOG_LEVEL: typeof w.LOG_LEVEL === 'string' && w.LOG_LEVEL.length > 0 ? w.LOG_LEVEL : 'info',
  // Absent on disk means the logger's own fallback, so show the value
  // that is actually in force rather than an empty box.
  LOG_MAX_MB: String(typeof w.LOG_MAX_MB === 'number' ? w.LOG_MAX_MB : DEFAULT_LOG_MAX_MB),
  ...captureSettings(w)
})

/**
 * Pruning RequestLog is the one destructive action here with a
 * non-obvious consequence: Usage and cost are computed from those rows,
 * so deleting them silently lowers historical spend. Say it in the
 * confirm, where it cannot be missed.
 */
const EXTRA_WARNING: Partial<Record<StoreId, string>> = {
  requestLog: 'Usage and cost totals are computed from these rows, so historical spend figures will drop.',
  message: 'The session view replays these turns; pruned conversations can no longer be read back.'
}

function CaptureSection({
  draft,
  onChange
}: {
  draft: LoggingDraft
  onChange: <K extends keyof LoggingDraft>(key: K, value: LoggingDraft[K]) => void
}) {
  return (
    <>
      <SectionHead title='Request capture' meta='what lands in Activity' />
      <ToggleField
        label='Record requests'
        hint='One RequestLog row per upstream call — tokens, cost, latency, routing decision. Off also empties the Usage and cost figures for the period it is off.'
        value={draft.CAPTURE_REQUESTS}
        onChange={(v) => onChange('CAPTURE_REQUESTS', v)}
      />
      <ToggleField
        label='Record messages'
        hint='Chat turns for the session view. Never includes the system prompt or tool definitions.'
        value={draft.CAPTURE_MESSAGES}
        onChange={(v) => onChange('CAPTURE_MESSAGES', v)}
      />
      <ToggleField
        label='Redact tool arguments'
        hint='Blanks tool_use input and tool_result content before archiving, keeping the prose. Off by default: the arguments are destroyed on the way in, so a turn archived with this on can never be read back in full.'
        value={draft.REDACT_TOOL_ARGUMENTS}
        onChange={(v) => onChange('REDACT_TOOL_ARGUMENTS', v)}
      />

      <div className='px-6 py-4'>
        <WarnNotice title='Message capture stores conversation content' tag='privacy'>
          User and assistant turns are written to Postgres in the clear so the session view can replay them. On a shared
          database, turn Record messages off, or leave it on with tool arguments redacted and the Message store pruned
          below.
        </WarnNotice>
      </div>
    </>
  )
}

function RetentionSection({ stats, reload }: { stats: StorageStats | null; reload: () => void }) {
  const [cutoffs, setCutoffs] = useState<Record<string, number>>({})
  const [pruning, setPruning] = useState<StoreId | null>(null)

  const prune = (store: StoreStats, days: number) => {
    const extra = EXTRA_WARNING[store.id]
    const tail = extra === undefined ? '' : `\n\n${extra}`
    const unit = store.rows === null ? 'files' : 'rows'
    if (!window.confirm(`Delete ${store.label} ${unit} older than ${days} days? This cannot be undone.${tail}`)) return
    setPruning(store.id)
    api
      .post<{ store: StoreId; deleted: number }>('/storage/prune', { store: store.id, olderThanDays: days })
      .then((res) => {
        toast.success(`${res.deleted} ${unit} deleted from ${store.label}.`)
        reload()
      })
      .catch((e: Error) => toast.error(`Prune failed: ${e.message}`))
      .finally(() => setPruning(null))
  }

  const unbounded = stats === null ? 0 : stats.stores.filter((s) => s.retention === null).length

  return (
    <>
      <SectionHead
        title='Retention'
        meta={
          stats === null
            ? 'reading…'
            : `${fmtBytes(totalBytes(stats.stores))} total · ${unbounded} of ${stats.stores.length} stores unbounded`
        }
      />
      {stats === null ? (
        <div className='px-6 py-4 text-xs text-muted-foreground'>Measuring the stores…</div>
      ) : (
        <RetentionTable
          stores={stats.stores}
          cutoffs={cutoffs}
          onCutoff={(id, days) => setCutoffs({ ...cutoffs, [id]: days })}
          onPrune={prune}
          pruning={pruning}
        />
      )}
      <div className='px-6 py-4 text-[11px] leading-relaxed text-muted-foreground'>
        Nothing schedules a prune. The cutoff above is the argument to the button beside it, not a stored policy — a
        store marked <span className='font-medium text-foreground'>unbounded</span> keeps growing until someone runs
        this by hand. Sizes come from <span className='font-mono'>pg_total_relation_size</span>, so they include indexes
        and TOAST.
      </div>
    </>
  )
}

export function SettingsLogging() {
  const navigate = useNavigate()
  const [wire, setWire] = useState<EnvelopeWire | null>(null)
  const [draft, setDraft] = useState<LoggingDraft | null>(null)
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadStats = useCallback(() => {
    api
      .get<StorageStats>('/storage')
      .then(setStats)
      .catch((e: Error) => toast.error(`Could not measure the stores: ${e.message}`))
  }, [])

  const load = useCallback(() => {
    api
      .get<EnvelopeWire>('/config')
      .then((res) => {
        setWire(res)
        setDraft(toDraft(res))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
    loadStats()
  }, [loadStats])

  useEffect(load, [load])

  const dirty = useMemo(
    () => wire !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(wire)),
    [draft, wire]
  )

  const save = () => {
    if (draft === null) return
    const LOG_MAX_MB = parseCount(draft.LOG_MAX_MB)
    if (LOG_MAX_MB === null || LOG_MAX_MB === 0) {
      toast.error('Rotate size must be a whole number of megabytes above zero.')
      return
    }
    setSaving(true)
    api
      .post<{ success: boolean; message: string }>('/config', {
        LOG: draft.LOG,
        LOG_LEVEL: draft.LOG_LEVEL,
        LOG_MAX_MB,
        CAPTURE_REQUESTS: draft.CAPTURE_REQUESTS,
        CAPTURE_MESSAGES: draft.CAPTURE_MESSAGES,
        REDACT_TOOL_ARGUMENTS: draft.REDACT_TOOL_ARGUMENTS
      })
      .then((res) => {
        toast.success(res.message)
        load()
      })
      .catch((e: Error) => toast.error(`Save failed: ${e.message}`))
      .finally(() => setSaving(false))
  }

  const set = <K extends keyof LoggingDraft>(key: K, value: LoggingDraft[K]) => {
    if (draft !== null) setDraft({ ...draft, [key]: value })
  }

  const logFiles = stats === null ? undefined : stats.stores.find((s) => s.id === 'logFiles')
  const level = draft === null ? '–' : draft.LOG_LEVEL
  const captured = stats === null ? '–' : fmtBytes(totalBytes(stats.stores))

  return (
    <SettingsLayout
      active='logging'
      title='Logging'
      subtitle={`level ${level} · ${captured} captured`}
      headerNote='pino, to the logs directory under the config home'
      headerActions={
        <RButton variant='outline' icon='ri-external-link-line' onClick={() => navigate('/activity/logs')}>
          Open in Activity
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
      ) : draft === null ? (
        <div className='px-6 py-6 text-xs text-muted-foreground'>Loading…</div>
      ) : (
        <>
          <ToggleField
            label='Write to file'
            hint='Off keeps logging to stdout only.'
            value={draft.LOG}
            onChange={(v) => set('LOG', v)}
          />
          <SelectField
            label='Level'
            hint='fatal · error · warn · info · debug · trace'
            value={draft.LOG_LEVEL}
            options={LOG_LEVELS}
            onChange={(v) => set('LOG_LEVEL', v)}
          />
          <TextField
            label='Rotate at'
            hint='Megabytes. A new file is started past this size.'
            value={draft.LOG_MAX_MB}
            inputMode='numeric'
            onChange={(v) => set('LOG_MAX_MB', v)}
          />
          <StaticField
            label='Keep files'
            hint='Rotation never deletes an old file — this is the count on disk, not a limit. Prune them below.'
            value={logFiles === undefined || logFiles.retention === null ? '–' : logFiles.retention}
          />
          <CaptureSection draft={draft} onChange={set} />
        </>
      )}

      <RetentionSection stats={stats} reload={loadStats} />
      <div className='h-10' />
    </SettingsLayout>
  )
}
