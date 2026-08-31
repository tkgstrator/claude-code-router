/**
 * Settings → Access. Who is allowed to reach Rialto, and with what.
 *
 * The mock designs a hashed, individually revocable access-token table
 * scoped to an inbound surface and a routing profile. That model is
 * Phase 3.5 and does not exist: today the entire `/api/*` and `/v1/*`
 * surface is gated by one shared secret (`process.env.APIKEY`, see
 * src/api/api-key-auth.ts), and `/api/identity` reports the Cloudflare
 * Access headers without verifying them. This screen renders the real
 * pair and labels the token table as the unbuilt capability it is,
 * rather than backing it with invented rows.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pill, RButton } from '@/components/rialto/primitives'
import { GuardsCard } from '@/components/rialto/settings/access/GuardsCard'
import { SectionHead } from '@/components/rialto/settings/fields'
import { NotYetAvailable } from '@/components/rialto/settings/notice'
import { SettingsField, SettingsLayout } from '@/components/rialto/settings/SettingsLayout'
import { api, type IdentityResponse } from '@/lib/api'
import { type EnvelopeWire, SECRET_MASK } from '@/lib/rialto/settings/envelope'

const ZERO_TRUST_URL = 'https://one.dash.cloudflare.com/'

function SignedInAs({ identity }: { identity: IdentityResponse | null }) {
  const viaAccess = identity?.mode === 'cloudflare_access'
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
        <span className='font-mono text-xs'>{identity?.email ? identity.email : 'no Access identity'}</span>
        {viaAccess ? <Pill tone='info'>forwarded</Pill> : <Pill tone='mute'>bootstrap token</Pill>}
      </div>
      <div className='text-[11px] leading-relaxed text-muted-foreground'>
        Display only. Rialto reads the header but does not yet verify the{' '}
        <span className='font-mono'>Cf-Access-Jwt-Assertion</span> against your team's JWKS, so nothing gates on this
        value — the real gate is Access at the edge plus the bootstrap token below.
      </div>
    </div>
  )
}

function AdminAccessSection({ identity }: { identity: IdentityResponse | null }) {
  return (
    <>
      <SettingsField
        label='Signed in as'
        hint='From the Cf-Access-Authenticated-User-Email header that Cloudflare adds once the edge policy has passed.'
      >
        <SignedInAs identity={identity} />
      </SettingsField>

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
            <span className='font-mono'>/v1</span> must bypass Access: Claude Code, Codex and Gemini CLI cannot complete
            an interactive login and do not send service-token headers. The bootstrap token below is that path's only
            gate.
          </p>
        </div>
      </SettingsField>
    </>
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
      <SectionHead title='Bootstrap token' lead={<Pill tone='mute'>envelope</Pill>} meta='the only gate on /v1/*' />
      <SettingsField
        label='APIKEY'
        hint='Stored in the on-disk envelope and mirrored onto process.env. Accepted as x-api-key or Authorization: Bearer on every /api/* and /v1/* request. One secret, shared by every client.'
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

function AccessTokensSection() {
  return (
    <>
      <SectionHead title='Access tokens' meta='per-client credentials' />
      <div className='px-6 pb-4'>
        <NotYetAvailable
          what='Per-client token table'
          needs={
            <>
              There is no <span className='font-mono'>AccessToken</span> store and no endpoint behind it — every client
              presents the one bootstrap token above, so nothing here can be listed, scoped or revoked individually.
              Filling this table needs the Phase 3.5 backend: a table of SHA-256 digests with a name, an inbound
              endpoint, a routing profile and a last-used timestamp, plus issue and revoke routes. Until then, rotating
              the shared secret is the only revocation, and it logs out every client at once.
            </>
          }
        />
      </div>
    </>
  )
}

export function SettingsAccess() {
  const [identity, setIdentity] = useState<IdentityResponse | null>(null)
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    api
      .getIdentity()
      .then(setIdentity)
      .catch(() => {
        // Display-only row: a failed probe leaves it on the token
        // fallback rather than blanking the section.
      })
    api
      .get<EnvelopeWire>('/config')
      .then((res) => setApiKey(typeof res.APIKEY === 'string' ? res.APIKEY : ''))
      .catch((e: Error) => toast.error(`Could not read the config envelope: ${e.message}`))
  }, [])

  const viaAccess = identity?.mode === 'cloudflare_access'

  return (
    <SettingsLayout
      active='access'
      title='Access'
      subtitle={`${viaAccess ? 'Cloudflare Access' : 'No Access'} on /api · one shared bootstrap token on /v1`}
      headerBadge={viaAccess ? <Pill tone='ok'>Cloudflare Access</Pill> : <Pill tone='warn'>No Access in front</Pill>}
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
      <AdminAccessSection identity={identity} />
      <BootstrapTokenSection apiKey={apiKey} />
      <div className='px-6 pb-2'>
        <GuardsCard />
      </div>
      <AccessTokensSection />
      <div className='h-8' />
    </SettingsLayout>
  )
}
