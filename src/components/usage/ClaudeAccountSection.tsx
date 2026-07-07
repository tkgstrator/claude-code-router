import { useTranslation } from 'react-i18next'
import { fmtReset } from '@/lib/usage/format'
import type { ClaudeAccountUsage } from '@/lib/usage/types'
import { UsageBar } from './UsageBar'

export function ClaudeAccountSection({ account }: { account: ClaudeAccountUsage }) {
  const { t } = useTranslation()
  return (
    <div className='space-y-3 rounded-md border p-4'>
      <p className='text-sm font-medium text-foreground'>{account.accountLabel}</p>
      {account.fiveHour && (
        <UsageBar
          label={t('usage.fiveHour')}
          percent={account.fiveHour.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.fiveHour.resetsAt)}`}
        />
      )}
      {account.sevenDay && (
        <UsageBar
          label={t('usage.sevenDay')}
          percent={account.sevenDay.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.sevenDay.resetsAt)}`}
        />
      )}
      {account.sevenDaySonnet && (
        <UsageBar
          label={t('usage.sevenDaySonnet')}
          percent={account.sevenDaySonnet.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.sevenDaySonnet.resetsAt)}`}
        />
      )}
      {account.sevenDayOpus && (
        <UsageBar
          label={t('usage.sevenDayOpus')}
          percent={account.sevenDayOpus.utilization}
          reset={`${t('usage.resets')}: ${fmtReset(account.sevenDayOpus.resetsAt)}`}
        />
      )}
      <div className='text-xs text-muted-foreground'>
        {t('usage.capturedAt')}: {fmtReset(account.capturedAt)}
      </div>
    </div>
  )
}
