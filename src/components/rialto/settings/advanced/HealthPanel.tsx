/**
 * The Health tab: whatever `GET /health` says, unedited.
 *
 * The probe lives at the root rather than under `/api` so uptime checks
 * do not need the bootstrap token. That also puts it outside the Vite
 * dev-server's default passthrough, so it is listed explicitly in the
 * dev-server exclude list — without that entry the SPA shell answers and
 * every check reads unreachable.
 */
import { useCallback, useEffect, useState } from 'react'
import { Pill, RButton } from '@/components/rialto/primitives'
import { SectionHead } from '@/components/rialto/settings/fields'
import { SettingsField } from '@/components/rialto/settings/SettingsLayout'
import { api, type HealthResponse } from '@/lib/api'

const CHECK_TONES = { ok: 'ok', fail: 'bad', skip: 'mute' } as const

export function HealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [reachable, setReachable] = useState(true)

  const load = useCallback(() => {
    api
      .getHealth()
      .then((res) => {
        setHealth(res)
        setReachable(true)
      })
      .catch(() => setReachable(false))
  }, [])

  useEffect(load, [load])

  return (
    <>
      <SectionHead
        title='Health'
        meta='GET /health · unauthenticated'
        actions={
          <RButton variant='ghost' icon='ri-refresh-line' onClick={load}>
            Refresh
          </RButton>
        }
      />
      <SettingsField
        label='Status'
        hint='Degraded means the server answered but a dependency check failed. Unreachable means it did not answer at all.'
      >
        {!reachable ? (
          <Pill tone='bad'>unreachable</Pill>
        ) : health === null ? (
          <Pill tone='mute'>probing…</Pill>
        ) : health.status === 'ok' ? (
          <Pill tone='ok'>ok</Pill>
        ) : (
          <Pill tone='warn'>degraded</Pill>
        )}
      </SettingsField>
      <SettingsField label='Reported version' hint='The version the running process believes it is.'>
        <span className='font-mono text-xs'>{health === null ? '–' : `v${health.version}`}</span>
      </SettingsField>
      <SettingsField label='Uptime' hint='Seconds since the process booted.'>
        <span className='font-mono text-xs tabular-nums'>{health === null ? '–' : health.uptime_seconds}</span>
      </SettingsField>
      <SettingsField label='Dependency checks' hint='One entry per dependency the probe touches.'>
        {health === null ? (
          <span className='text-[11px] text-muted-foreground'>Nothing reported.</span>
        ) : (
          <div className='flex flex-wrap items-center gap-2'>
            {Object.entries(health.checks).map(([name, state]) => (
              <Pill key={name} tone={CHECK_TONES[state]}>
                {name} · {state}
              </Pill>
            ))}
          </div>
        )}
      </SettingsField>
    </>
  )
}
