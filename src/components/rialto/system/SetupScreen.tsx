/**
 * First-run screen. Replaces SetupDialog.
 *
 * SetupDialog asked for an APIKEY in a modal before the operator had any
 * model of what Rialto is, so "why am I being asked this" had nowhere to
 * live. This states the shape of the system first, then walks the two
 * things that actually unblock the install: a provider to route to, and a
 * credential a client can authenticate with.
 *
 * Full page, no app shell — the sidebar's five destinations mean nothing
 * until something answers.
 */
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { Pill, RButton } from '@/components/rialto/primitives'
import { type AccessTokenWire, api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Provider } from '@/types'
import { APP_VERSION } from '@/version'

type StepState = 'done' | 'active' | 'todo'

const DOT: Record<StepState, string> = {
  done: 'bg-foreground text-background',
  active: 'bg-foreground text-background',
  todo: 'bg-muted text-muted-foreground'
}

// Only claude and codex have an OAuth initiate endpoint. Gemini is listed
// because it is one of the four inbound surfaces, and every card hands off
// to the Providers screen, which owns the connect flow either way.
const CONNECT_OPTIONS: Array<{ label: string; icon: string; hint: string }> = [
  { label: 'Claude Code', icon: 'ri-sparkling-line', hint: 'Pro / Max' },
  { label: 'Codex', icon: 'ri-terminal-line', hint: 'ChatGPT plan' },
  { label: 'Gemini CLI', icon: 'ri-gemini-line', hint: 'AI Pro / Ultra' }
]

// A seeded catalog row is not a usable provider: api_key stays null until
// someone pastes one, and a subscription row is dead until an account on
// it is enabled.
const isConnected = (provider: Provider): boolean => {
  if (provider.auth_mode === 'subscription') {
    const accounts = provider.subscription_accounts
    return accounts === undefined ? false : accounts.some((account) => account.enabled)
  }
  return provider.api_key !== null && provider.api_key.length > 0
}

// Mirrors the server's own liveness test in access-token-service: listing
// returns revoked and expired rows too, and neither will authenticate.
const isLive = (token: AccessTokenWire, now: number): boolean => {
  if (token.revokedAt !== null) return false
  return token.expiresAt === null ? true : Date.parse(token.expiresAt) > now
}

const plural = (n: number, word: string): string => `${n} ${n === 1 ? word : `${word}s`}`

const nextTokenName = (live: number): string => (live === 0 ? 'first client' : `client ${live + 1}`)

function Step({
  n,
  state,
  title,
  body,
  children
}: {
  n: number
  state: StepState
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className={cn('flex gap-4 border-t border-border px-6 py-5', state === 'todo' ? 'opacity-50' : '')}>
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
          DOT[state]
        )}
      >
        {state === 'done' ? <i className='ri-check-line text-xs' /> : n}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <h2 className='text-xs font-semibold'>{title}</h2>
          {state === 'done' ? <Pill tone='ok'>done</Pill> : null}
        </div>
        <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>{body}</p>
        {children}
      </div>
    </div>
  )
}

/**
 * The export block, in its two states.
 *
 * Before issuing it shows the shape rather than a value, because the only
 * credential the page could otherwise offer — the envelope bootstrap token
 * — is admin-only now and would 401 on the client's first request. After
 * issuing it shows the plaintext in full: a masked token cannot be pasted,
 * and pasting it is the entire point of this block.
 */
function ExportBlock({ baseUrl, plaintext }: { baseUrl: string; plaintext: string | null }) {
  const [copied, setCopied] = useState(false)
  const [clipboardError, setClipboardError] = useState<string | null>(null)

  const copy = () => {
    if (plaintext === null) return
    navigator.clipboard.writeText(plaintext).then(
      () => setCopied(true),
      () => setClipboardError('Clipboard was refused — select the token above and copy it by hand.')
    )
  }

  return (
    <>
      <div className='mt-3 rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed break-all'>
        <div>export ANTHROPIC_BASE_URL={baseUrl}</div>
        {plaintext === null ? (
          <div className='text-muted-foreground'>export ANTHROPIC_AUTH_TOKEN=…</div>
        ) : (
          <div>export ANTHROPIC_AUTH_TOKEN={plaintext}</div>
        )}
        <div>claude</div>
      </div>
      {plaintext === null ? null : (
        <div className='mt-2 flex items-start gap-2'>
          <RButton
            variant='outline'
            icon={copied ? 'ri-check-line' : 'ri-file-copy-line'}
            className='shrink-0'
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </RButton>
          <span className='text-[11px] leading-relaxed text-muted-foreground'>
            {clipboardError === null
              ? 'Shown once. Rialto stores only a hash of it, so leaving this page loses the value — issuing a replacement is the only way back.'
              : clipboardError}
          </span>
        </div>
      )}
    </>
  )
}

export function SetupScreen() {
  const { config } = useConfig()
  const navigate = useNavigate()
  const [tokens, setTokens] = useState<AccessTokenWire[] | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getAccessTokens()
      .then((res) => setTokens(res.tokens))
      .catch(() => {
        // A failed listing only costs the "you already have N" hint; the
        // issue action below still works and is the point of the step.
      })
  }, [])

  const providers = config === null ? [] : config.Providers
  const connected = providers.filter(isConnected).length
  const live = tokens === null ? 0 : tokens.filter((token) => isLive(token, Date.now())).length

  // The URL the operator's browser used to get here is, by construction,
  // a URL that reaches this server — through a tunnel, over the LAN, or on
  // loopback. config.PORT would only be right in the third case.
  const baseUrl = window.location.origin

  const issue = () => {
    setIssuing(true)
    setIssueError(null)
    api
      .issueAccessToken({ name: nextTokenName(live) })
      .then((result) => {
        setIssued(result.plaintext)
        setTokens(tokens === null ? [result.token] : [result.token, ...tokens])
      })
      .catch((err: unknown) => setIssueError(err instanceof Error ? err.message : 'Could not issue a token.'))
      .finally(() => setIssuing(false))
  }

  const catalogBody = `Migrations applied and the model catalog seeded. ${plural(providers.length, 'provider')} registered, ${
    connected === 0 ? 'none authenticated yet' : `${connected} authenticated`
  }.`

  return (
    <div className='flex min-h-screen items-center justify-center bg-background px-6 py-10'>
      <div className='w-full max-w-2xl rounded-lg border border-border'>
        <div className='px-6 pt-6 pb-5'>
          <div className='flex items-center gap-2.5'>
            <div className='flex size-7 items-center justify-center rounded bg-foreground text-background'>
              <i className='ri-route-line text-base leading-none' />
            </div>
            <span className='text-base font-semibold tracking-tight'>Rialto</span>
            <span className='ml-auto font-mono text-[10px] text-muted-foreground'>v{APP_VERSION}</span>
          </div>
          <p className='mt-4 text-xs leading-relaxed text-muted-foreground'>
            Rialto sits between your coding clients and the model vendors. Clients speak whichever wire format they
            already speak — <span className='font-mono'>/v1/messages</span>,{' '}
            <span className='font-mono'>/v1/chat/completions</span>, <span className='font-mono'>/v1/responses</span>,
            or Gemini's — and Rialto decides which model actually serves each request, failing over when a subscription
            runs out of quota.
          </p>
        </div>

        <Step n={1} state='done' title='Database ready' body={catalogBody} />

        <Step
          n={2}
          state={connected === 0 ? 'active' : 'done'}
          title='Connect a provider'
          body='Rialto needs at least one place to send requests. A subscription (Claude / Codex / Gemini) reuses a plan you already pay for; an API key bills per token.'
        >
          <div className='mt-3 grid grid-cols-3 gap-2'>
            {CONNECT_OPTIONS.map((option) => (
              <Link
                key={option.label}
                to='/providers'
                className='rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/50'
              >
                <i className={cn(option.icon, 'text-sm text-muted-foreground')} />
                <div className='mt-1 text-[11px] font-medium'>{option.label}</div>
                <div className='text-[10px] text-muted-foreground'>{option.hint}</div>
              </Link>
            ))}
          </div>
          <Link
            to='/providers'
            className='mt-2 inline-block text-[11px] text-muted-foreground underline-offset-2 hover:underline'
          >
            Use an API key instead
          </Link>
        </Step>

        <Step
          n={3}
          state={connected === 0 ? 'todo' : 'active'}
          title='Point a client at Rialto'
          body='The proxy answers only to an issued access token — a fresh install can serve nothing until one exists. Issue one, export it with the base URL, then run your client as usual.'
        >
          <ExportBlock baseUrl={baseUrl} plaintext={issued} />
          {issued === null ? (
            <div className='mt-2 flex items-start gap-2'>
              <RButton variant='outline' icon='ri-key-2-line' className='shrink-0' onClick={issue} disabled={issuing}>
                {issuing ? 'Issuing…' : 'Issue a token'}
              </RButton>
              <span className='text-[11px] leading-relaxed text-muted-foreground'>
                {live === 0
                  ? 'Nothing can call the proxy yet.'
                  : `You already have ${plural(live, 'token')}. Issue another, or paste one you saved — the plaintext of an existing token cannot be shown again.`}
              </span>
            </div>
          ) : null}
          {issueError === null ? null : <p className='mt-2 text-[11px] text-destructive'>{issueError}</p>}
        </Step>

        <div className='flex items-center gap-3 border-t border-border px-6 py-4'>
          <span className='text-[11px] text-muted-foreground'>
            The token in <span className='font-mono'>~/.claude-code-router/config.json</span> signs you into this UI.
            Clients use an access token.
          </span>
          <Link to='/overview' className='ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:underline'>
            Skip setup
          </Link>
          <RButton variant='primary' onClick={() => navigate(connected === 0 ? '/providers' : '/overview')}>
            Continue <i className='ri-arrow-right-line text-sm' />
          </RButton>
        </div>
      </div>
    </div>
  )
}
