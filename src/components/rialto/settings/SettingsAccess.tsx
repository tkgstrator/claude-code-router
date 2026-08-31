/**
 * Settings → Access. Who is allowed to reach Rialto, and with what.
 *
 * Two independent gates, and the screen's job is to make it obvious
 * which one is actually load-bearing:
 *
 *   /api/*  — Cloudflare Access when ACCESS_TEAM_DOMAIN + ACCESS_AUD are
 *             set (the assertion is verified against the team JWKS
 *             before any handler runs), otherwise the bootstrap token
 *             alone.
 *   /v1/*   — per-client access tokens, and only those: the bootstrap
 *             token is deliberately refused here, so a leaked master
 *             key cannot spend the subscription unattributably. This
 *             path has to be a Bypass app at the edge, because Claude
 *             Code, Codex and Gemini CLI cannot complete an interactive
 *             Access login. No tokens issued means no proxying at all.
 *
 * `accessConfigured: false` on a deployment reachable from the internet
 * means one shared secret is the only thing in front of the admin API,
 * so it is stated at the top of the page rather than inferred from a
 * missing pill.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pill, RButton } from '@/components/rialto/primitives'
import { AccessTokensSection } from '@/components/rialto/settings/access/AccessTokensSection'
import { GuardsCard } from '@/components/rialto/settings/access/GuardsCard'
import { SectionHead } from '@/components/rialto/settings/fields'
import { SettingsField, SettingsLayout } from '@/components/rialto/settings/SettingsLayout'
import { api, type IdentityResponse, type InboundSurfaceWire } from '@/lib/api'
import { type EnvelopeWire, SECRET_MASK } from '@/lib/rialto/settings/envelope'

const ZERO_TRUST_URL = 'https://one.dash.cloudflare.com/'

function SignedInAs({ identity }: { identity: IdentityResponse | null }) {
  if (identity === null) return <span className='text-[11px] text-muted-foreground'>Checking…</span>

  const viaAccess = identity.mode === 'cloudflare_access'
  return (
    <div className='flex items-center gap-2'>
      <i
        className={
          viaAccess
            ? 'ri-shield-check-line text-sm text-emerald-600 dark:text-emerald-400'
            : 'ri-key-2-line text-sm text-muted-foreground'
        }
      />
      <span className='font-mono text-xs'>{identity.email === null ? 'bootstrap token' : identity.email}</span>
      {viaAccess ? <Pill tone='ok'>verified</Pill> : <Pill tone='mute'>no Access identity</Pill>}
    </div>
  )
}

/**
 * The exposure statement.
 *
 * One line by design: the mock has nothing in this position, so a block
 * here displaces the whole page. The sentence that earns the space is
 * "anyone holding it has full administrative control" — what that covers
 * is spelled out in the guards card below.
 */
function ExposureNotice({ identity }: { identity: IdentityResponse }) {
  if (identity.accessConfigured) return null
  return (
    <div className='px-6 pt-1 pb-3'>
      <div className='flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[11px] leading-relaxed'>
        <i className='ri-alert-line shrink-0 text-sm text-amber-600 dark:text-amber-400' />
        <span>
          <span className='font-medium'>Cloudflare Access is not configured</span> — the bootstrap token alone gates{' '}
          <span className='font-mono'>/api/*</span>, so anyone holding it has full administrative control. Set{' '}
          <span className='font-mono'>ACCESS_TEAM_DOMAIN</span> and <span className='font-mono'>ACCESS_AUD</span>.
        </span>
      </div>
    </div>
  )
}

function BootstrapTokenSection({ apiKey }: { apiKey: string }) {
  const [revealed, setRevealed] = useState(false)
  const present = apiKey.length > 0

  const copy = () => {
    navigator.clipboard
      .writeText(apiKey)
      .then(() => toast.success('Bootstrap token copied.'))
      .catch(() => toast.error('Clipboard write was refused by the browser.'))
  }

  return (
    <>
      <SectionHead
        title='Bootstrap token'
        lead={<Pill tone='mute'>envelope</Pill>}
        meta='break-glass admin credential'
      />
      <SettingsField
        label='APIKEY'
        hint='Stored in the on-disk envelope and mirrored onto process.env. Accepted on /api/* only — the recovery path when Access or the database is down. The proxy refuses it.'
      >
        <div className='flex items-center gap-2'>
          <div className='flex h-8 max-w-md flex-1 items-center overflow-hidden rounded-md border border-border px-3 font-mono text-xs'>
            {!present ? 'not set' : revealed ? apiKey : SECRET_MASK}
          </div>
          <RButton
            variant='ghost'
            icon={revealed ? 'ri-eye-off-line' : 'ri-eye-line'}
            onClick={() => setRevealed(!revealed)}
            disabled={!present}
          >
            {revealed ? 'Hide' : 'Reveal'}
          </RButton>
          <RButton variant='ghost' icon='ri-file-copy-line' onClick={copy} disabled={!present}>
            Copy
          </RButton>
        </div>
      </SettingsField>
    </>
  )
}

function PolicyCoverage() {
  return (
    <SettingsField label='Policy coverage' hint='Which Access apps sit on this hostname.'>
      <div className='space-y-2'>
        <div className='rounded-md border border-dashed border-border px-3 py-1.5 text-[11px] text-muted-foreground'>
          <i className='ri-tools-line mr-1 align-[-1px]' />
          Listing the Access apps needs a Cloudflare API token and a Zero Trust proxy — check them in the dashboard.
        </div>
        <p className='text-[11px] leading-relaxed text-muted-foreground'>
          <span className='font-mono'>/v1</span> must be a <span className='font-medium text-foreground'>Bypass</span>{' '}
          policy. Claude Code, Codex and Gemini CLI cannot complete an interactive Access login, so putting Access in
          front of that path locks every client out — the access tokens below are its gate instead.
        </p>
      </div>
    </SettingsField>
  )
}

export function SettingsAccess() {
  const [identity, setIdentity] = useState<IdentityResponse | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [surfaces, setSurfaces] = useState<InboundSurfaceWire[]>([])

  useEffect(() => {
    api
      .getIdentity()
      .then(setIdentity)
      .catch((e: Error) => toast.error(`Could not read the caller identity: ${e.message}`))
    api
      .get<EnvelopeWire>('/config')
      .then((res) => setApiKey(typeof res.APIKEY === 'string' ? res.APIKEY : ''))
      .catch((e: Error) => toast.error(`Could not read the config envelope: ${e.message}`))
    api
      .getInboundSurfaces()
      .then((res) => setSurfaces(res.surfaces))
      .catch(() => {
        // Scoping pickers fall back to "all endpoints", which is the
        // server's own default when surface is null.
      })
  }, [])

  const configured = identity?.accessConfigured === true
  const subtitle = configured
    ? 'Cloudflare Access on /api · scoped tokens on /v1'
    : 'Bootstrap token only on /api · scoped tokens on /v1'

  return (
    <SettingsLayout
      active='access'
      title='Access'
      subtitle={subtitle}
      headerBadge={configured ? <Pill tone='ok'>Cloudflare Access</Pill> : <Pill tone='bad'>No Access in front</Pill>}
      headerNote={window.location.hostname}
      headerActions={
        <RButton
          variant='outline'
          icon='ri-external-link-line'
          onClick={() => window.open(ZERO_TRUST_URL, '_blank', 'noopener,noreferrer')}
        >
          Open Zero Trust
        </RButton>
      }
    >
      {identity === null ? null : <ExposureNotice identity={identity} />}

      <SettingsField label='Signed in as' hint='The caller Rialto verified for this request.'>
        <SignedInAs identity={identity} />
      </SettingsField>
      <PolicyCoverage />

      <BootstrapTokenSection apiKey={apiKey} />

      <div className='px-6 pb-2'>
        <GuardsCard />
      </div>

      <AccessTokensSection surfaces={surfaces} />
      <div className='h-8' />
    </SettingsLayout>
  )
}
