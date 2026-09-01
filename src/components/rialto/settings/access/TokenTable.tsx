/**
 * The issued-token list.
 *
 * Revoke and delete are deliberately not the same control. Revoking
 * keeps the row, so RequestLog entries that reference this token still
 * resolve to a name and Activity can still say whose traffic a request
 * was. Deleting drops the row and that attribution goes with it — so
 * revoke is the plain action, and delete appears only once a row is
 * already revoked — by which point it changes nothing about access and
 * only trades away the audit trail.
 */
import { Trans, useTranslation } from 'react-i18next'
import { Pill, SurfacePill } from '@/components/rialto/primitives'
import { WarnNotice } from '@/components/rialto/settings/notice'
import type { InboundSurfaceWire } from '@/lib/api'
import { fmtAgo, fmtCount } from '@/lib/rialto/format'
import { type AccessTokenWire, sortTokens, type TokenState, tokenState } from '@/lib/rialto/settings/access-tokens'

const STATE_PILL: Record<TokenState, { tone: 'ok' | 'warn' | 'bad'; labelKey: string }> = {
  active: { tone: 'ok', labelKey: 'settings.access.tokenActive' },
  expired: { tone: 'warn', labelKey: 'settings.access.tokenExpired' },
  revoked: { tone: 'bad', labelKey: 'settings.access.tokenRevoked' }
}

function TokenRow({
  token,
  state,
  surfacePath,
  now,
  onRevoke,
  onDelete,
  busy
}: {
  token: AccessTokenWire
  state: TokenState
  surfacePath: string | undefined
  now: number
  onRevoke: () => void
  onDelete: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const dead = state !== 'active'
  return (
    <tr className={`border-t border-border/60 transition-colors hover:bg-muted/50 ${dead ? 'opacity-60' : ''}`}>
      <td className='py-2.5 pl-6 pr-3'>
        <div className='flex items-center gap-2'>
          <span className='text-xs font-medium'>{token.name}</span>
          {dead ? <Pill tone={STATE_PILL[state].tone}>{t(STATE_PILL[state].labelKey)}</Pill> : null}
        </div>
        <div className='font-mono text-[11px] text-muted-foreground'>{token.prefix}</div>
      </td>
      <td className='px-3'>
        {surfacePath === undefined ? (
          <span className='text-[11px] text-muted-foreground/50'>{t('settings.access.scopeAll')}</span>
        ) : (
          <SurfacePill path={surfacePath} />
        )}
      </td>
      <td className='px-3 font-mono text-[11px] text-muted-foreground'>
        {token.profileKey === null ? '—' : token.profileKey}
      </td>
      <td className='px-3 text-right font-mono text-xs tabular-nums'>{fmtCount(token.requestCount)}</td>
      <td className='px-3 text-right text-[11px] text-muted-foreground'>
        {token.lastUsedAt === null
          ? t('settings.access.never')
          : t('settings.access.lastUsedAgo', { ago: fmtAgo(token.lastUsedAt, now) })}
      </td>
      <td className='px-3 text-right text-[11px] text-muted-foreground'>
        {token.expiresAt === null ? t('settings.access.never') : token.expiresAt.slice(0, 10)}
      </td>
      <td className='py-2.5 pl-3 pr-6 text-right'>
        {state === 'revoked' ? (
          <button
            type='button'
            onClick={onDelete}
            disabled={busy}
            className='text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50'
          >
            {t('settings.access.delete')}
          </button>
        ) : (
          <button
            type='button'
            onClick={onRevoke}
            disabled={busy}
            className='text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50'
          >
            {t('settings.access.revoke')}
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
  onDelete
}: {
  tokens: AccessTokenWire[]
  surfaces: InboundSurfaceWire[]
  now: number
  busyId: string | null
  onRevoke: (token: AccessTokenWire) => void
  onDelete: (token: AccessTokenWire) => void
}) {
  const { t } = useTranslation()
  if (tokens.length === 0) {
    // Not a neutral empty list: with no token issued the proxy accepts
    // nothing, so this is the difference between a working gateway and
    // a dead one and has to read that way.
    return (
      <div className='px-6 pb-6'>
        <WarnNotice title={t('settings.access.noTokensTitle')} tag={t('settings.access.noTokensTag')}>
          <Trans i18nKey='settings.access.noTokensBody' components={{ mono: <span className='font-mono' /> }} />
        </WarnNotice>
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
          <th className='pb-2 pl-6 pr-3 text-left font-medium'>{t('settings.access.colToken')}</th>
          <th className='px-3 text-left font-medium'>{t('settings.access.colEndpoint')}</th>
          <th className='px-3 text-left font-medium'>{t('settings.access.colProfile')}</th>
          <th className='px-3 text-right font-medium'>{t('settings.access.colRequests')}</th>
          <th className='px-3 text-right font-medium'>{t('settings.access.colLastUsed')}</th>
          <th className='px-3 text-right font-medium'>{t('settings.access.colExpires')}</th>
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
            onDelete={() => onDelete(token)}
          />
        ))}
      </tbody>
    </table>
  )
}
