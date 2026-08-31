import { useTranslation } from 'react-i18next'
import dayjs from '@/lib/dayjs'
import type { SubscriptionAccount } from '@/lib/usage/types'

// Warn once the Codex subscription is this close to lapsing, so the
// operator can renew before access stops.
const SOON_MS = 3 * 24 * 60 * 60 * 1000

const BADGE = 'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium'

// Per-account auth-health chip. Driven by the probed authStatus (the
// authoritative "does this account authenticate" signal), with a Codex-only
// subscription-expiry warning layered on top of a still-live account.
export function AccountAuthBadge({
  account,
  kind
}: {
  account: SubscriptionAccount
  kind: 'claude' | 'codex' | 'other'
}) {
  const { t } = useTranslation()
  const checkedTitle =
    account.authCheckedAt !== null
      ? `${t('usage.authCheckedAt')}: ${dayjs(account.authCheckedAt).format('YYYY/MM/DD HH:mm')}`
      : undefined

  if (account.authStatus === 'invalid') {
    return (
      <span
        className={`${BADGE} bg-red-500/15 text-red-600 dark:text-red-400`}
        title={account.authError ?? checkedTitle}
      >
        {t('usage.authInvalid')}
      </span>
    )
  }

  // Codex subscription ending/ended — still authenticated, and access
  // tokens keep refreshing on their own, but once the subscription
  // lapses the upstream stops accepting them entirely.
  if (kind === 'codex' && account.subscriptionEndsAt !== null && account.subscriptionEndsAt - Date.now() <= SOON_MS) {
    const ended = account.subscriptionEndsAt <= Date.now()
    return (
      <span
        className={`${BADGE} bg-amber-500/15 text-amber-600 dark:text-amber-400`}
        title={`${dayjs(account.subscriptionEndsAt).format('YYYY/MM/DD')}`}
      >
        {ended ? t('usage.subEnded') : t('usage.subEndingSoon')}
      </span>
    )
  }

  if (account.authStatus === 'live') {
    return (
      <span className={`${BADGE} bg-green-500/15 text-green-600 dark:text-green-400`} title={checkedTitle}>
        {t('usage.authLive')}
      </span>
    )
  }

  return (
    <span className={`${BADGE} bg-muted text-muted-foreground`} title={checkedTitle}>
      {t('usage.authUnknown')}
    </span>
  )
}

// Simplified two-state chip for the Subscriptions list: just active vs
// expired, with no badge until the account has been probed at least once.
export function SubscriptionAuthBadge({ account }: { account: SubscriptionAccount }) {
  const { t } = useTranslation()
  if (account.authStatus === 'invalid') {
    return (
      <span className={`${BADGE} bg-red-500/15 text-red-600 dark:text-red-400`} title={account.authError ?? undefined}>
        {t('subscriptions.authExpired')}
      </span>
    )
  }
  if (account.authStatus === 'live') {
    return (
      <span className={`${BADGE} bg-green-500/15 text-green-600 dark:text-green-400`}>
        {t('subscriptions.authActive')}
      </span>
    )
  }
  return null
}
