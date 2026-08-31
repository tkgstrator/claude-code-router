/**
 * The UI loaded but /api/* is not answering.
 *
 * This is the one system state that must not be a friendly shrug. When the
 * database is down the proxy at /v1/* usually keeps serving from its
 * cached configuration, so "everything is broken" is both wrong and
 * expensive — the operator needs to know what is still up before they
 * restart anything.
 */
import { useEffect, useState } from 'react'
import { Pill } from '@/components/rialto/primitives'
import { api, type HealthResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SystemPage } from './SystemPage'

const POLL_MS = 5000

type CheckState = HealthResponse['checks'][string]

// /health resolving at all is the liveness signal; it rejects on a
// transport failure or a non-JSON body, which is what "unreachable"
// actually means here.
interface Probe {
  health: HealthResponse | null
  detail: string
}

const CHECK_LABELS: Record<string, string> = { db: 'Database' }

const CHECK_DOTS: Record<CheckState, string> = {
  ok: 'bg-emerald-500',
  fail: 'bg-destructive',
  skip: 'bg-amber-500'
}

// compose.yaml names the Postgres service `postgres`. A failed check is
// only worth a command when there is exactly one obvious next one.
const REMEDIES: Record<string, string> = { db: 'docker compose up -d postgres' }

const probeHealth = async (): Promise<Probe> => {
  try {
    const health = await api.getHealth()
    return { health, detail: `${health.status} · /health` }
  } catch (error) {
    return { health: null, detail: error instanceof Error ? error.message : 'no response' }
  }
}

function StatusRow({ label, tone, detail }: { label: string; tone: string; detail: string }) {
  return (
    <div className='flex items-center gap-2 rounded-md border border-border px-3 py-1.5'>
      <span className={cn('size-1.5 rounded-full', tone)} />
      <span className='text-[11px]'>{label}</span>
      <span className='ml-auto font-mono text-[11px] text-muted-foreground'>{detail}</span>
    </div>
  )
}

export function ApiUnreachable({ probe }: { probe: Probe | null }) {
  // Unknown check names render as themselves rather than being dropped: a
  // check the UI has never heard of is still one the operator should see
  // failing.
  const checks = probe === null || probe.health === null ? [] : Object.entries(probe.health.checks)
  const remedy = checks
    .filter(([, state]) => state === 'fail')
    .map(([name]) => REMEDIES[name])
    .find((command) => command !== undefined)

  return (
    <div className='w-full max-w-sm'>
      <div className='flex items-center gap-2'>
        <i className='ri-plug-line text-base text-destructive' />
        <h3 className='text-sm font-semibold'>Cannot reach the Rialto API</h3>
        <Pill tone='warn'>retrying</Pill>
      </div>
      <p className='mt-2 text-[11px] leading-relaxed text-muted-foreground'>
        The UI is loaded but <span className='font-mono'>/api/config</span> is not answering. The proxy at{' '}
        <span className='font-mono'>/v1/*</span> may still be serving requests from its cached configuration — check
        before restarting.
      </p>
      <div className='mt-3 space-y-1.5'>
        <StatusRow
          label='Proxy'
          tone={probe === null ? 'bg-muted-foreground/40' : probe.health === null ? 'bg-destructive' : 'bg-emerald-500'}
          detail={probe === null ? 'probing…' : probe.detail}
        />
        {checks.map(([name, state]) => {
          const known = CHECK_LABELS[name]
          return (
            <StatusRow key={name} label={known === undefined ? name : known} tone={CHECK_DOTS[state]} detail={state} />
          )
        })}
      </div>
      {remedy === undefined ? null : (
        <div className='mt-3 rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px]'>{remedy}</div>
      )}
    </div>
  )
}

/** Route / error-boundary entry. Keeps probing so the page self-heals. */
export function ApiUnreachableScreen() {
  const [probe, setProbe] = useState<Probe | null>(null)

  useEffect(() => {
    const mounted = { value: true }
    const run = () => {
      probeHealth().then((next) => {
        if (mounted.value) setProbe(next)
      })
    }
    run()
    const timer = setInterval(run, POLL_MS)
    return () => {
      mounted.value = false
      clearInterval(timer)
    }
  }, [])

  return (
    <SystemPage>
      <ApiUnreachable probe={probe} />
    </SystemPage>
  )
}
