/**
 * Step 2 of the add-provider flow: prove we may call the vendor.
 *
 * Two ways in for a subscription vendor. Browser OAuth is the happy path;
 * importing the CLI's existing credentials is the escape hatch for
 * headless boxes where no browser can reach the loopback callback. The
 * failure state is rendered inline rather than as a toast because this
 * flow fails often enough — expired refresh token, wrong account, no Code
 * Assist onboarding — that the reason is the only actionable part.
 */
import { useRef } from 'react'
import { Pill, RButton } from '@/components/rialto/primitives'
import { fmtAgo } from '@/lib/rialto/format'
import { cn } from '@/lib/utils'
import type { CatalogEntry } from './types'
import { vendorBrand, vendorLabel } from './vendor-labels'

export type OAuthKind = 'claude' | 'codex'

function VendorIntro({ entry }: { entry: CatalogEntry }) {
  const subscription = entry.authMode === 'subscription'
  const brand = vendorBrand(entry.name, entry.vendor)
  return (
    <div className='border-b border-border px-6 py-4'>
      <div className='flex items-center gap-2'>
        <h2 className='text-sm font-semibold'>{vendorLabel(entry.name, entry.displayName)}</h2>
        {subscription ? <Pill tone='info'>subscription</Pill> : <Pill tone='mute'>api key</Pill>}
      </div>
      <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>
        {subscription
          ? `Uses your ${brand} subscription entitlement. Rialto never sees your password — it exchanges an OAuth code and stores only the encrypted tokens.`
          : `Calls ${entry.apiBaseUrl} with a key you provide. The key is stored on this Rialto install and sent only to ${brand}.`}
      </p>
    </div>
  )
}

function ChoiceCard({
  icon,
  title,
  body,
  selected,
  disabled,
  onClick
}: {
  icon: string
  title: string
  body: React.ReactNode
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md px-4 py-3 text-left transition-colors',
        selected ? 'border-2 border-foreground/40 bg-muted/40' : 'border border-border hover:bg-muted/50',
        disabled ? 'opacity-45' : ''
      )}
    >
      <div className='flex items-center gap-2'>
        <i className={cn(icon, 'text-sm', selected ? '' : 'text-muted-foreground')} />
        <span className='text-xs font-medium'>{title}</span>
        {selected ? <Pill tone='ok'>recommended</Pill> : null}
      </div>
      <p className='mt-1.5 text-[11px] leading-relaxed text-muted-foreground'>{body}</p>
    </button>
  )
}

function WaitingCard({
  kind,
  manualUrl,
  onManualUrlChange,
  onSubmitManual,
  busy
}: {
  kind: OAuthKind
  manualUrl: string
  onManualUrlChange: (v: string) => void
  onSubmitManual: () => void
  busy: boolean
}) {
  return (
    <div className='px-6 py-5'>
      <div className='rounded-md border border-border px-4 py-4'>
        <div className='flex items-center gap-2'>
          <i className='ri-loader-4-line text-sm text-muted-foreground' />
          <span className='text-xs font-medium'>Waiting for the vendor…</span>
        </div>
        <p className='mt-1.5 text-[11px] leading-relaxed text-muted-foreground'>
          A browser tab should have opened. Finish there and this page will continue on its own.
        </p>
        {/* Only the claude flow accepts a pasted redirect: codex's OAuth
            client whitelists a single loopback port, which the standalone
            listener on :1455 already owns. */}
        {kind === 'claude' ? (
          <div className='mt-3 rounded-md bg-muted/50 px-3 py-2'>
            <div className='text-[11px] text-muted-foreground'>Or paste the redirect URL manually</div>
            <div className='mt-1.5 flex items-center gap-2'>
              <input
                value={manualUrl}
                onChange={(e) => onManualUrlChange(e.target.value)}
                placeholder='http://localhost:3456/callback?code=…&state=…'
                spellCheck={false}
                className='h-8 flex-1 rounded-md border border-border bg-background px-3 font-mono text-[11px] text-muted-foreground outline-none focus:text-foreground'
              />
              <RButton variant='outline' onClick={onSubmitManual} disabled={busy || manualUrl.trim() === ''}>
                Submit
              </RButton>
            </div>
            <p className='mt-1.5 text-[11px] leading-relaxed text-muted-foreground'>
              Needed when Rialto runs behind a tunnel and the browser cannot reach loopback.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export interface AuthFailure {
  message: string
  /** ISO instant, or null for an error raised in this session. */
  at: string | null
}

function FailureCard({ failure, now }: { failure: AuthFailure; now: number }) {
  return (
    <div className='px-6 pb-6'>
      <div className='rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3'>
        <div className='flex items-center gap-2'>
          <i className='ri-error-warning-line text-sm text-destructive' />
          <span className='text-xs font-medium'>Previous attempt failed</span>
          {failure.at === null ? null : (
            <span className='ml-auto text-[11px] text-muted-foreground'>{fmtAgo(failure.at, now)} ago</span>
          )}
        </div>
        <p className='mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground'>{failure.message}</p>
      </div>
    </div>
  )
}

function ApiKeyForm({
  entry,
  value,
  onChange,
  onSave,
  busy
}: {
  entry: CatalogEntry
  value: string
  onChange: (v: string) => void
  onSave: () => void
  busy: boolean
}) {
  return (
    <>
      <div className='px-6 pt-5 pb-2'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>How to authenticate</h3>
      </div>
      <div className='space-y-3 px-6 pb-5'>
        <div>
          <div className='mb-1 text-[11px] text-muted-foreground'>API key</div>
          <div className='flex items-center gap-2'>
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={`Key for ${vendorBrand(entry.name, entry.vendor)}`}
              spellCheck={false}
              autoComplete='off'
              className='h-8 flex-1 rounded-md border border-border bg-transparent px-3 font-mono text-xs outline-none focus:border-foreground/40'
            />
            <RButton variant='primary' icon='ri-check-line' onClick={onSave} disabled={busy || value.trim() === ''}>
              Save key
            </RButton>
          </div>
        </div>
        <div>
          <div className='mb-1 text-[11px] text-muted-foreground'>Base URL</div>
          <div className='flex h-8 items-center rounded-md border border-border px-3 font-mono text-xs'>
            {entry.apiBaseUrl}
          </div>
        </div>
        <p className='text-[11px] leading-relaxed text-muted-foreground'>
          Supports <span className='font-mono'>$VAR</span> interpolation — the key is read from the environment at boot
          rather than stored, if you prefer.
        </p>
      </div>
    </>
  )
}

export interface ConnectAuthStepProps {
  entry: CatalogEntry
  /** Which OAuth exchange the server can run for this vendor; null when none. */
  oauthKind: OAuthKind | null
  pending: boolean
  busy: boolean
  failure: AuthFailure | null
  now: number
  manualUrl: string
  apiKeyDraft: string
  onSignIn: () => void
  onImport: (file: File) => void
  onManualUrlChange: (v: string) => void
  onSubmitManual: () => void
  onApiKeyChange: (v: string) => void
  onSaveApiKey: () => void
}

function SubscriptionChoices({
  entry,
  oauthKind,
  busy,
  onSignIn,
  onImport
}: {
  entry: CatalogEntry
  oauthKind: OAuthKind | null
  busy: boolean
  onSignIn: () => void
  onImport: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const brand = vendorBrand(entry.name, entry.vendor)
  const credPath = entry.credentialsPath === null ? "the CLI's credentials file" : entry.credentialsPath
  return (
    <>
      <div className='px-6 pt-5 pb-2'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>How to authenticate</h3>
      </div>
      <div className='grid grid-cols-2 gap-3 px-6'>
        <ChoiceCard
          icon='ri-external-link-line'
          title={`Sign in with ${brand}`}
          selected={oauthKind !== null}
          disabled={busy || oauthKind === null}
          onClick={onSignIn}
          body={
            oauthKind === null ? (
              <>This Rialto build has no OAuth exchange for {brand}. Import the CLI's credentials instead.</>
            ) : (
              <>
                Opens {brand} in your browser and returns to <span className='font-mono'>/callback</span>.
              </>
            )
          }
        />
        <ChoiceCard
          icon='ri-folder-open-line'
          title={`Import from ${entry.cli === null ? 'the CLI' : entry.cli}`}
          selected={false}
          disabled={busy || oauthKind === null}
          onClick={() => fileRef.current?.click()}
          body={
            <>
              Reads <span className='font-mono'>{credPath}</span> if you have already signed in on this machine.
            </>
          }
        />
      </div>
      <input
        ref={fileRef}
        type='file'
        accept='application/json,.json'
        className='hidden'
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onImport(file)
          e.target.value = ''
        }}
      />
    </>
  )
}

export function ConnectAuthStep(props: ConnectAuthStepProps) {
  const { entry, oauthKind, failure } = props
  const subscription = entry.authMode === 'subscription'
  return (
    <div className='min-w-0 overflow-y-auto'>
      <VendorIntro entry={entry} />
      {subscription ? (
        <SubscriptionChoices
          entry={entry}
          oauthKind={oauthKind}
          busy={props.busy}
          onSignIn={props.onSignIn}
          onImport={props.onImport}
        />
      ) : (
        <ApiKeyForm
          entry={entry}
          value={props.apiKeyDraft}
          onChange={props.onApiKeyChange}
          onSave={props.onSaveApiKey}
          busy={props.busy}
        />
      )}
      {props.pending && oauthKind !== null ? (
        <WaitingCard
          kind={oauthKind}
          manualUrl={props.manualUrl}
          onManualUrlChange={props.onManualUrlChange}
          onSubmitManual={props.onSubmitManual}
          busy={props.busy}
        />
      ) : null}
      {failure === null ? null : <FailureCard failure={failure} now={props.now} />}
      <div className='h-6' />
    </div>
  )
}
