/**
 * Issue form.
 *
 * Surface and profile are the reason per-client tokens exist at all — a
 * token pinned to `/v1/chat/completions` on `cost-first` is how one
 * client gets its own routing without a second config axis — so both are
 * first-class fields here rather than an advanced disclosure. Both lists
 * come from the server (`/api/inbound-surfaces`,
 * `/api/router-preferences/profiles`); nothing about them is hardcoded.
 */
import { useState } from 'react'
import { RButton } from '@/components/rialto/primitives'
import { SettingsField } from '@/components/rialto/settings/SettingsLayout'
import type { InboundSurfaceWire } from '@/lib/api'
import { EXPIRY_CHOICES } from '@/lib/rialto/settings/access-tokens'

export interface IssueDraft {
  name: string
  surface: string
  profileKey: string
  expiry: string
}

/** Sentinel for the "not scoped" option — the wire sends null for these. */
export const ANY = ''

export const emptyDraft = (): IssueDraft => ({ name: '', surface: ANY, profileKey: ANY, expiry: 'never' })

const SELECT_CLASS =
  'inline-flex h-8 w-full max-w-md appearance-none items-center rounded-md border border-border bg-transparent pl-3 pr-8 font-mono text-xs transition-colors hover:bg-muted/60'

function Picker({
  label,
  value,
  onChange,
  children
}: {
  label: string
  value: string
  onChange: (next: string) => void
  children: React.ReactNode
}) {
  return (
    <div className='relative inline-flex w-full max-w-md'>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
        {children}
      </select>
      <i className='ri-arrow-down-s-line pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground' />
    </div>
  )
}

export function IssueTokenForm({
  draft,
  surfaces,
  profiles,
  issuing,
  onChange,
  onSubmit,
  onCancel
}: {
  draft: IssueDraft
  surfaces: InboundSurfaceWire[]
  profiles: { key: string }[]
  issuing: boolean
  onChange: (next: IssueDraft) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const set = <K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) => onChange({ ...draft, [key]: value })

  return (
    <>
      <SettingsField label='Name' hint='How this client is identified in the list and in Activity.'>
        <input
          type='text'
          value={draft.name}
          autoFocus
          placeholder='MacBook — Claude Code'
          onChange={(e) => set('name', e.target.value)}
          className='flex h-8 w-full max-w-md items-center rounded-md border border-border bg-transparent px-3 font-mono text-xs outline-none focus:border-foreground/40'
        />
      </SettingsField>

      <SettingsField label='Endpoint' hint='Restrict the token to one inbound surface. Unset lets it call all of them.'>
        <Picker label='Endpoint' value={draft.surface} onChange={(v) => set('surface', v)}>
          <option value={ANY}>all endpoints</option>
          {surfaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.path}
            </option>
          ))}
        </Picker>
      </SettingsField>

      <SettingsField
        label='Routing profile'
        hint="Route this client's traffic through a named profile. Unset follows the endpoint's own routing."
      >
        <Picker label='Routing profile' value={draft.profileKey} onChange={(v) => set('profileKey', v)}>
          <option value={ANY}>follow the endpoint</option>
          {profiles.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key}
            </option>
          ))}
        </Picker>
      </SettingsField>

      <SettingsField label='Expires' hint='A bounded token limits the damage if it leaks. Revoke works either way.'>
        <Picker label='Expires' value={draft.expiry} onChange={(v) => set('expiry', v)}>
          {EXPIRY_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Picker>
      </SettingsField>

      <div className='flex items-center gap-2 border-t border-border/60 px-6 py-4'>
        <span className='text-[11px] text-muted-foreground'>
          The token is shown once, immediately after issuing, and never again.
        </span>
        <div className='ml-auto flex gap-2'>
          <RButton variant='ghost' onClick={onCancel}>
            Cancel
          </RButton>
          <RButton
            variant='primary'
            icon='ri-key-2-line'
            onClick={onSubmit}
            disabled={issuing || draft.name.trim().length === 0}
          >
            Issue token
          </RButton>
        </div>
      </div>
    </>
  )
}
