/**
 * Access tokens — issue, list, revoke, delete.
 *
 * Owns the one-time plaintext: it is held in component state only for as
 * long as the reveal panel is open, and is never written anywhere it
 * could be read back. The list refreshes after every mutation rather
 * than being patched locally, so `lastUsedAt` and `requestCount` cannot
 * drift from what the gate actually recorded.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pill, RButton } from '@/components/rialto/primitives'
import { IssuedTokenPanel } from '@/components/rialto/settings/access/IssuedTokenPanel'
import { ANY, emptyDraft, type IssueDraft, IssueTokenForm } from '@/components/rialto/settings/access/IssueTokenForm'
import { TokenTable } from '@/components/rialto/settings/access/TokenTable'
import { SectionHead } from '@/components/rialto/settings/fields'
import { api, type InboundSurfaceWire } from '@/lib/api'
import {
  type AccessTokenWire,
  countTokens,
  EXPIRY_CHOICES,
  expiryToIso,
  type IssuedTokenWire
} from '@/lib/rialto/settings/access-tokens'

interface Revealed {
  plaintext: string
  name: string
  scope: string
  profile: string
  expiry: string
}

const expiryLabel = (choiceId: string): string => {
  const choice = EXPIRY_CHOICES.find((c) => c.id === choiceId)
  return choice === undefined ? 'No expiry' : choice.label
}

const summary = (counts: { active: number; expired: number; revoked: number }): string => {
  const parts = [`${counts.active} active`]
  if (counts.expired > 0) parts.push(`${counts.expired} expired`)
  if (counts.revoked > 0) parts.push(`${counts.revoked} revoked`)
  return parts.join(' · ')
}

export function AccessTokensSection({ surfaces }: { surfaces: InboundSurfaceWire[] }) {
  const [tokens, setTokens] = useState<AccessTokenWire[]>([])
  const [profiles, setProfiles] = useState<{ key: string }[]>([])
  const [draft, setDraft] = useState<IssueDraft | null>(null)
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  // Pinned per load so every relative label on the page measures from
  // the same instant, and so an expiry cannot flip mid-render.
  const [now, setNow] = useState(Date.now())

  const load = useCallback(() => {
    api
      .get<{ tokens: AccessTokenWire[] }>('/access-tokens')
      .then((res) => {
        setTokens(res.tokens)
        setNow(Date.now())
      })
      .catch((e: Error) => toast.error(`Could not list access tokens: ${e.message}`))
  }, [])

  useEffect(() => {
    load()
    api
      .get<{ profiles: { key: string }[] }>('/router-preferences/profiles')
      .then((res) => setProfiles(res.profiles))
      .catch(() => {
        // The picker falls back to "follow the endpoint", which is the
        // server's own default when profileKey is null.
      })
  }, [load])

  const issue = () => {
    if (draft === null) return
    setIssuing(true)
    api
      .post<IssuedTokenWire>('/access-tokens', {
        name: draft.name.trim(),
        surface: draft.surface === ANY ? null : draft.surface,
        profileKey: draft.profileKey === ANY ? null : draft.profileKey,
        expiresAt: expiryToIso(draft.expiry, Date.now())
      })
      .then((res) => {
        const surfacePath = surfaces.find((s) => s.id === res.token.surface)?.path
        setRevealed({
          plaintext: res.plaintext,
          name: res.token.name,
          scope: surfacePath === undefined ? 'all endpoints' : surfacePath,
          profile: res.token.profileKey === null ? 'follow the endpoint' : res.token.profileKey,
          expiry: expiryLabel(draft.expiry)
        })
        setDraft(null)
        load()
      })
      .catch((e: Error) => toast.error(`Could not issue the token: ${e.message}`))
      .finally(() => setIssuing(false))
  }

  const revoke = (token: AccessTokenWire) => {
    if (!window.confirm(`Revoke "${token.name}"? Any client using it stops working immediately.`)) return
    setBusyId(token.id)
    api
      .post<AccessTokenWire>(`/access-tokens/${encodeURIComponent(token.id)}/revoke`, {})
      .then(() => {
        toast.success(`"${token.name}" revoked.`)
        load()
      })
      .catch((e: Error) => toast.error(`Revoke failed: ${e.message}`))
      .finally(() => setBusyId(null))
  }

  // Deleting a revoked token needs `DELETE /api/access-tokens/{id}`.
  // The shared client exposes get/post/put only — `deleteRequest` is
  // private — so the control is rendered and explained rather than wired
  // to a call that cannot be made from here.
  const DELETE_BLOCKED =
    'Deleting needs a DELETE verb on the shared API client, which only exposes get/post/put today. Revoke does everything delete does for access; only the attribution cleanup is unavailable.'

  const counts = countTokens(tokens, now)

  return (
    <>
      <SectionHead
        title='Access tokens'
        meta={
          <>
            {summary(counts)} · all on <span className='font-mono'>/v1/*</span>
          </>
        }
        actions={
          draft === null && revealed === null ? (
            <RButton variant='primary' icon='ri-add-line' onClick={() => setDraft(emptyDraft())}>
              Issue token
            </RButton>
          ) : null
        }
      />

      {revealed !== null ? (
        <IssuedTokenPanel {...revealed} onDone={() => setRevealed(null)} />
      ) : draft !== null ? (
        <IssueTokenForm
          draft={draft}
          surfaces={surfaces}
          profiles={profiles}
          issuing={issuing}
          onChange={setDraft}
          onSubmit={issue}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <>
          <div className='px-6 pb-4'>
            <div className='rounded-md border border-dashed border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
              <i className='ri-information-line mr-1 align-[-1px]' />
              Only a SHA-256 digest is stored — the plaintext is shown once, when the token is issued. Scoping a token
              to an endpoint and a routing profile is how one client gets its own routing without touching anyone else's
              chain. <span className='font-medium text-foreground'>Revoke</span> keeps the row so past requests still
              say whose traffic they were; delete drops that attribution.
            </div>
          </div>
          <TokenTable
            tokens={tokens}
            surfaces={surfaces}
            now={now}
            busyId={busyId}
            onRevoke={revoke}
            deleteBlockedReason={DELETE_BLOCKED}
          />
        </>
      )}
    </>
  )
}
