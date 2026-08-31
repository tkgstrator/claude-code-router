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
import { NotYetAvailable, WarnNotice } from '@/components/rialto/settings/notice'
import { SettingsField, SettingsLayout } from '@/components/rialto/settings/SettingsLayout'
import { api, type IdentityResponse, type InboundSurfaceWire } from '@/lib/api'
import { type EnvelopeWire, SECRET_MASK } from '@/lib/rialto/settings/envelope'

const ZERO_TRUST_URL = 'https://one.dash.cloudflare.com/'

function SignedInAs({ identity }: { identity: IdentityResponse | null }) {
  if (identity === null) return <span className='text-[11px] text-muted-foreground'>Checking…</span>

  const viaAccess = identity.mode === 'cloudflare_access'
  return (
    <div className='space-y-1.5'>
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
      <div className='text-[11px] leading-relaxed text-muted-foreground'>
        {viaAccess
          ? 'The assertion was checked for signature, issuer and audience before this request reached a handler, so a forged header cannot produce this name.'
          : 'This request authenticated with the shared bootstrap token, so Rialto has no idea which person made it.'}
      </div>
    </div>
  )
}

/**
 * The exposure statement. Deliberately the loudest thing on the page
 * when Access is off: behind a public tunnel that configuration means
 * one leaked string is full admin access.
 */
function ExposureNotice({ identity }: { identity: IdentityResponse }) {
  if (identity.accessConfigured) return null
  return (
    <div className='px-6 pb-4'>
      <WarnNotice title='Cloudflare Access is not configured' tag='exposure'>
        Every <span className='font-mono'>/api/*</span> request — this UI, the config document, provider keys — is gated
        by the single bootstrap token below and nothing else. Anyone who obtains that string has full administrative
        control. Set <span className='font-mono'>ACCESS_TEAM_DOMAIN</span> and{' '}
        <span className='font-mono'>ACCESS_AUD</span> to put an identity check in front of it before exposing this host
        publicly.
      </WarnNotice>
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
        hint='Stored in the on-disk envelope and mirrored onto process.env. Accepted on /api/* only, so a database outage or a broken Access policy cannot lock you out of the admin UI. The proxy refuses it outright — /v1/* takes issued access tokens and nothing else.'
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
      <div className='space-y-3'>
        <NotYetAvailable
          what='Access app list'
          needs={
            <>
              Reading the Access apps for this hostname needs a Cloudflare API token and a server-side proxy for the
              Zero Trust API. Neither exists — check the policies in the Zero Trust dashboard for now.
            </>
          }
        />
        <p className='text-[11px] leading-relaxed text-muted-foreground'>
          <span className='font-mono'>/v1</span> must be a <span className='font-medium text-foreground'>Bypass</span>{' '}
          policy. Claude Code, Codex and Gemini CLI cannot complete an interactive Access login and do not send
          service-token headers, so putting Access in front of that path locks every client out — the access tokens
          below are its gate instead.
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
