/**
 * Outbound credentials for an api_key provider.
 *
 * The field is masked until the operator asks for it and only becomes
 * editable once revealed — a screenshot of this page should never carry a
 * working key, and an accidental keystroke should never silently replace
 * one either.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RButton } from '@/components/rialto/primitives'
import { maskKey } from './derive'
import type { Provider } from './types'

export function CredentialsPanel({
  provider,
  label,
  onSave
}: {
  provider: Provider
  label: string
  onSave: (key: string) => void
}) {
  const stored = provider.api_key === null ? '' : provider.api_key
  const [revealed, setRevealed] = useState(false)
  const [draft, setDraft] = useState(stored)

  // Switching providers must not carry the previous provider's key (or a
  // half-typed edit) into the new field.
  useEffect(() => {
    setRevealed(false)
    setDraft(stored)
  }, [stored])

  const dirty = draft !== stored
  return (
    <div className='border-r border-border'>
      <div className='px-6 pt-5 pb-2'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Credentials</h3>
      </div>
      <div className='space-y-3 px-6 pb-5'>
        <div>
          <div className='mb-1 text-[11px] text-muted-foreground'>API key</div>
          <div className='flex items-center gap-2'>
            {revealed ? (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                autoComplete='off'
                className='h-8 flex-1 rounded-md border border-border bg-transparent px-3 font-mono text-xs outline-none focus:border-foreground/40'
              />
            ) : (
              <div className='flex h-8 flex-1 items-center rounded-md border border-border px-3 font-mono text-xs'>
                {stored === '' ? 'not set' : maskKey(stored)}
              </div>
            )}
            <RButton
              variant='ghost'
              icon={revealed ? 'ri-eye-off-line' : 'ri-eye-line'}
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </RButton>
            {dirty ? (
              <RButton variant='primary' icon='ri-check-line' onClick={() => onSave(draft)}>
                Save
              </RButton>
            ) : null}
          </div>
        </div>
        <div>
          <div className='mb-1 text-[11px] text-muted-foreground'>Base URL</div>
          <div className='flex h-8 items-center rounded-md border border-border px-3 font-mono text-xs'>
            {provider.api_base_url}
          </div>
        </div>
        <p className='text-[11px] leading-relaxed text-muted-foreground'>
          Supports <span className='font-mono'>$VAR</span> interpolation — the key is read from the environment at boot
          rather than stored, if you prefer.
        </p>
        <p className='text-[11px] leading-relaxed text-muted-foreground'>
          <span className='font-medium text-foreground'>Outbound only.</span> This is what Rialto sends to {label}. It
          has nothing to do with the{' '}
          <Link to='/settings/access' className='underline underline-offset-2'>
            access tokens
          </Link>{' '}
          that let your clients into Rialto.
        </p>
      </div>
    </div>
  )
}
