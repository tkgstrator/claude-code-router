/**
 * Where the OAuth callback tab ends up. Replaces OauthResultPage.
 *
 * The token exchange and the SubAccount write already happened server-side
 * (GET /callback for claude, the standalone :1455 listener for codex) by
 * the time this mounts, so both states are read-only reports — there is
 * nothing here to retry in place.
 *
 * Query params, unchanged from the old page so live redirects keep working:
 *   status   = "ok" | "error"
 *   provider = "claude" | "codex"
 *   message  = human-readable detail (error only)
 */
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RButton } from '@/components/rialto/primitives'
import { SystemPage } from './SystemPage'

// The callback only ever sends claude or codex today; gemini is here so a
// third flow does not land on the generic label the day it ships.
const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI'
}

const providerLabel = (raw: string | null): string => {
  if (raw === null) return 'Provider'
  const known = PROVIDER_LABELS[raw]
  return known === undefined ? 'Provider' : known
}

export function OauthConnected({ provider }: { provider: string }) {
  const navigate = useNavigate()
  return (
    <div className='w-full max-w-xs text-center'>
      <div className='mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-500/10'>
        <i className='ri-check-line text-lg text-emerald-600 dark:text-emerald-400' />
      </div>
      <h3 className='mt-3 text-sm font-semibold'>{provider} connected</h3>
      <p className='mt-1.5 text-[11px] leading-relaxed text-muted-foreground'>
        Tokens stored encrypted. You can close this tab — the Providers screen has already updated.
      </p>
      <RButton variant='outline' className='mt-4' onClick={() => navigate('/providers')}>
        Back to Rialto <i className='ri-arrow-right-line text-sm' />
      </RButton>
    </div>
  )
}

export function OauthFailed({ message }: { message: string | null }) {
  const navigate = useNavigate()
  return (
    <div className='w-full max-w-sm text-center'>
      <div className='mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10'>
        <i className='ri-close-line text-lg text-destructive' />
      </div>
      <h3 className='mt-3 text-sm font-semibold'>Could not complete sign-in</h3>
      <p className='mt-1.5 text-[11px] leading-relaxed text-muted-foreground'>
        The provider returned an error before Rialto could exchange the code. Nothing was stored.
      </p>
      {message === null ? null : (
        <div className='mt-3 rounded-md bg-muted/60 px-3 py-2 text-left font-mono text-[11px] leading-relaxed whitespace-pre-wrap'>
          {message}
        </div>
      )}
      <div className='mt-4 flex justify-center gap-2'>
        {/* The single-use `state` was consumed by the failed exchange, so
            "try again" has to restart the flow from Providers rather than
            replay this URL. */}
        <RButton variant='primary' icon='ri-refresh-line' onClick={() => navigate('/providers')}>
          Try again
        </RButton>
        <RButton variant='outline' onClick={() => navigate('/overview')}>
          Back
        </RButton>
      </div>
    </div>
  )
}

/** Route entry for /oauth-result — picks the state off the query string. */
export function OauthResultScreen() {
  const [params] = useSearchParams()
  const status = params.get('status')
  const message = params.get('message')

  return (
    <SystemPage>
      {status === 'ok' ? (
        <OauthConnected provider={providerLabel(params.get('provider'))} />
      ) : (
        // Anything that is not an explicit success is a failure: a
        // callback that lost its status param did not complete either.
        <OauthFailed message={message === null || message.length === 0 ? null : message} />
      )}
    </SystemPage>
  )
}
