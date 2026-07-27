import { useTranslation } from 'react-i18next'
import { fmtReset } from '@/lib/usage/format'
import type { CodexAccountUsage, SubscriptionAccount } from '@/lib/usage/types'
import { AccountAuthBadge } from './AuthBadge'
import { UsageBar } from './UsageBar'

// One Codex account cell (rendered inside the Usage page's account grid):
// identity + auth-health chip, then its rate-limit windows. `usage` is null
// when the account has no live/cached usage.
export function CodexAccountSection({
  account,
  usage
}: {
  account: SubscriptionAccount
  usage: CodexAccountUsage | null
}) {
  const { t } = useTranslation()
  const name = account.userName ?? account.userEmail ?? account.label
  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='min-w-0 truncate text-sm font-medium text-foreground'>{name}</p>
        <AccountAuthBadge account={account} kind='codex' />
      </div>
      {usage === null ? (
        <p className='text-xs text-muted-foreground'>{t('usage.noUsageData')}</p>
      ) : (
        <>
          {usage.primary && (
            <UsageBar
              label={t('usage.primary')}
              percent={usage.primary.usedPercent}
              reset={`${t('usage.resets')}: ${fmtReset(usage.primary.resetAt)}`}
            />
          )}
          {usage.secondary && (
            <UsageBar
              label={t('usage.secondary')}
              percent={usage.secondary.usedPercent}
              reset={`${t('usage.resets')}: ${fmtReset(usage.secondary.resetAt)}`}
            />
          )}
          <div className='text-xs text-muted-foreground'>
            {t('usage.capturedAt')}: {fmtReset(usage.capturedAt)}
          </div>
        </>
      )}
    </div>
  )
}
