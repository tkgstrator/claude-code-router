/**
 * The two settings that turn Cloudflare Access on — and the dry run that
 * has to pass before they can be saved.
 *
 * Saving a wrong team domain or AUD rejects every browser request,
 * including the one that would let you fix it, so `POST /api/access-check`
 * is a deliberate step in this flow rather than a background call. The
 * verdict is rendered verbatim; the three outcomes it distinguishes are
 * genuinely different and flattening them to pass/fail would lose the
 * one that matters most (domain fine, audience not yet provable).
 */
import { Pill, RButton } from '@/components/rialto/primitives'
import { SettingsField } from '@/components/rialto/settings/SettingsLayout'
import {
  type AccessCheckResponse,
  type AccessInput,
  type CheckTone,
  checkTone
} from '@/lib/rialto/settings/access-config'

const TONE_LABEL: Record<CheckTone, string> = {
  ok: 'verified',
  warn: 'unconfirmed',
  bad: 'would lock you out'
}

const INPUT_CLASS =
  'flex h-8 w-full max-w-md items-center rounded-md border border-border bg-transparent px-3 font-mono text-xs outline-none focus:border-foreground/40'

function Verdict({ check }: { check: AccessCheckResponse }) {
  const tone = checkTone(check)
  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-2'>
        <Pill tone={tone}>{TONE_LABEL[tone]}</Pill>
        {check.jwksReachable ? (
          <span className='font-mono text-[11px] text-muted-foreground'>{check.keyCount} signing keys</span>
        ) : null}
        {check.email === null ? null : <span className='font-mono text-[11px]'>{check.email}</span>}
      </div>
      <p className='text-[11px] leading-relaxed text-muted-foreground'>{check.detail}</p>
    </div>
  )
}

export function AccessConfigSection({
  draft,
  onChange,
  check,
  checking,
  onCheck,
  stale
}: {
  draft: AccessInput
  onChange: (next: AccessInput) => void
  check: AccessCheckResponse | null
  checking: boolean
  onCheck: () => void
  /** True when the draft has moved on from what `check` was run against. */
  stale: boolean
}) {
  const incomplete = draft.teamDomain.trim().length === 0 || draft.aud.trim().length === 0

  return (
    <>
      <SettingsField
        label='Team domain'
        hint='Looks like <team>.cloudflareaccess.com. Required together with the AUD tag — one alone enables nothing.'
      >
        <input
          type='text'
          value={draft.teamDomain}
          placeholder='acme.cloudflareaccess.com'
          onChange={(e) => onChange({ ...draft, teamDomain: e.target.value })}
          className={INPUT_CLASS}
        />
      </SettingsField>

      <SettingsField
        label='Application AUD'
        hint='The Application Audience tag from the Access app. Without it a token minted for any other app on your team would be accepted.'
      >
        <input
          type='text'
          value={draft.aud}
          placeholder='64 hex characters'
          onChange={(e) => onChange({ ...draft, aud: e.target.value })}
          className={INPUT_CLASS}
        />
      </SettingsField>

      <SettingsField label='Verify' hint='Nothing is saved by this. It reports whether these values would work.'>
        <div className='space-y-2'>
          <div className='flex items-center gap-2'>
            <RButton variant='outline' icon='ri-shield-check-line' onClick={onCheck} disabled={checking || incomplete}>
              {checking ? 'Checking…' : 'Check settings'}
            </RButton>
            {check !== null && stale ? (
              <span className='text-[11px] text-amber-600 dark:text-amber-400'>
                Values changed since this check — run it again.
              </span>
            ) : null}
          </div>
          {check === null ? null : <Verdict check={check} />}
        </div>
      </SettingsField>
    </>
  )
}
