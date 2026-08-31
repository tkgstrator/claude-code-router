/**
 * The issued-token list.
 *
 * Revoke and delete are deliberately not the same control. Revoking
 * keeps the row, so RequestLog entries that reference this token still
 * resolve to a name and Activity can still say whose traffic a request
 * was. Deleting drops the row and that attribution goes with it — so
 * revoke is the plain action, and delete appears only once a row is
 * already revoked.
 *
 * Delete is currently inert: the server has the route, but the shared
 * API client exposes no DELETE verb. It renders disabled with the reason
 * on hover rather than silently vanishing, because a reader needs to
 * know the capability exists and why it cannot be used yet.
 */
import { Pill, SurfacePill } from '@/components/rialto/primitives'
import type { InboundSurfaceWire } from '@/lib/api'
import { fmtAgo, fmtCount } from '@/lib/rialto/format'
import { type AccessTokenWire, sortTokens, type TokenState, tokenState } from '@/lib/rialto/settings/access-tokens'

const STATE_PILL: Record<TokenState, { tone: 'ok' | 'warn' | 'bad'; label: string }> = {
  active: { tone: 'ok', label: 'active' },
  expired: { tone: 'warn', label: 'expired' },
  revoked: { tone: 'bad', label: 'revoked' }
}

function TokenRow({
  token,
  state,
  surfacePath,
  now,
  onRevoke,
  deleteBlockedReason,
  busy
}: {
  token: AccessTokenWire
  state: TokenState
  surfacePath: string | undefined
  now: number
  onRevoke: () => void
  deleteBlockedReason: string
  busy: boolean
}) {
  const dead = state !== 'active'
  return (
    <tr className={`border-t border-border/60 transition-colors hover:bg-muted/50 ${dead ? 'opacity-60' : ''}`}>
      <td className='py-2.5 pl-6 pr-3'>
        <div className='flex items-center gap-2'>
          <span className='text-xs font-medium'>{token.name}</span>
          {dead ? <Pill tone={STATE_PILL[state].tone}>{STATE_PILL[state].label}</Pill> : null}
        </div>
        <div className='font-mono text-[11px] text-muted-foreground'>{token.prefix}</div>
      </td>
      <td className='px-3'>
        {surfacePath === undefined ? (
          <span className='text-[11px] text-muted-foreground/50'>all</span>
        ) : (
          <SurfacePill path={surfacePath} />
        )}
      </td>
      <td className='px-3 font-mono text-[11px] text-muted-foreground'>
        {token.profileKey === null ? '—' : token.profileKey}
      </td>
      <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtCount(token.requestCount)}</td>
      <td className='px-3 text-right text-[11px] text-muted-foreground'>
        {token.lastUsedAt === null ? 'never' : `${fmtAgo(token.lastUsedAt, now)} ago`}
      </td>
      <td className='px-3 text-right text-[11px] text-muted-foreground'>
        {token.expiresAt === null ? 'never' : token.expiresAt.slice(0, 10)}
      </td>
      <td className='py-2.5 pl-3 pr-6 text-right'>
        {state === 'revoked' ? (
          <button type='button' disabled title={deleteBlockedReason} className='text-[11px] text-muted-foreground/40'>
            Delete
          </button>
        ) : (
          <button
            type='button'
            onClick={onRevoke}
            disabled={busy}
            className='text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50'
          >
            Revoke
          </button>
        )}
      </td>
    </tr>
  )
}

export function TokenTable({
  tokens,
  surfaces,
  now,
  busyId,
  onRevoke,
  deleteBlockedReason
}: {
  tokens: AccessTokenWire[]
  surfaces: InboundSurfaceWire[]
  now: number
  busyId: string | null
  onRevoke: (token: AccessTokenWire) => void
  deleteBlockedReason: string
}) {
  if (tokens.length === 0) {
    return (
      <div className='px-6 pb-6 text-xs text-muted-foreground'>
        No tokens issued yet. Until one exists, every client on <span className='font-mono'>/v1/*</span> authenticates
        with the shared bootstrap token above.
      </div>
    )
  }
  return (
    <table className='w-full table-fixed'>
      <colgroup>
        <col />
        <col className='w-40' />
        <col className='w-24' />
        <col className='w-20' />
        <col className='w-24' />
        <col className='w-24' />
        <col className='w-20' />
      </colgroup>
      <thead>
        <tr className='text-[11px] uppercase tracking-wider text-muted-foreground/70'>
          <th className='pb-2 pl-6 pr-3 text-left font-medium'>Token</th>
          <th className='px-3 text-left font-medium'>Endpoint</th>
          <th className='px-3 text-left font-medium'>Profile</th>
          <th className='px-3 text-right font-medium'>Requests</th>
          <th className='px-3 text-right font-medium'>Last used</th>
          <th className='px-3 text-right font-medium'>Expires</th>
          <th className='pb-2 pl-3 pr-6' />
        </tr>
      </thead>
      <tbody>
        {sortTokens(tokens, now).map((token) => (
          <TokenRow
            key={token.id}
            token={token}
            state={tokenState(token, now)}
            surfacePath={surfaces.find((s) => s.id === token.surface)?.path}
            now={now}
            busy={busyId === token.id}
            onRevoke={() => onRevoke(token)}
            deleteBlockedReason={deleteBlockedReason}
          />
        ))}
      </tbody>
    </table>
  )
}
