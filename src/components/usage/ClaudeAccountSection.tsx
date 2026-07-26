import { useTranslation } from 'react-i18next'
import { fmtReset } from '@/lib/usage/format'
import type { ClaudeAccountUsage, SubscriptionAccount } from '@/lib/usage/types'
import { AccountAuthBadge } from './AuthBadge'
import { UsageBar } from './UsageBar'

// One Claude account cell (rendered inside the Usage page's account grid):
// identity + auth-health chip, then its rate-limit windows. `usage` is null
// when the account has no live/cached usage (auth dead, disabled, or not yet
// polled) — the chip still explains why.
export function ClaudeAccountSection({
  account,
  usage
}: {
  account: SubscriptionAccount
  usage: ClaudeAccountUsage | null
}) {
  const { t } = useTranslation()
  const name = account.userName ?? account.userEmail ?? account.label
  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='min-w-0 truncate text-sm font-medium text-foreground'>{name}</p>
        <AccountAuthBadge account={account} kind='claude' />
      </div>
      {usage === null ? (
        <p className='text-xs text-muted-foreground'>{t('usage.noUsageData')}</p>
      ) : (
        <>
          {usage.fiveHour && (
            <UsageBar
              label={t('usage.fiveHour')}
              percent={usage.fiveHour.utilization}
              reset={`${t('usage.resets')}: ${fmtReset(usage.fiveHour.resetsAt)}`}
            />
          )}
          {usage.sevenDay && (
            <UsageBar
              label={t('usage.sevenDay')}
              percent={usage.sevenDay.utilization}
              reset={`${t('usage.resets')}: ${fmtReset(usage.sevenDay.resetsAt)}`}
            />
          )}
          {usage.sevenDaySonnet && (
            <UsageBar
              label={t('usage.sevenDaySonnet')}
              percent={usage.sevenDaySonnet.utilization}
              reset={`${t('usage.resets')}: ${fmtReset(usage.sevenDaySonnet.resetsAt)}`}
            />
          )}
          {usage.sevenDayOpus && (
            <UsageBar
              label={t('usage.sevenDayOpus')}
              percent={usage.sevenDayOpus.utilization}
              reset={`${t('usage.resets')}: ${fmtReset(usage.sevenDayOpus.resetsAt)}`}
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
