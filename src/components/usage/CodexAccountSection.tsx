import { useTranslation } from 'react-i18next'
import { fmtReset } from '@/lib/usage/format'
import type { CodexAccountUsage } from '@/lib/usage/types'
import { UsageBar } from './UsageBar'

export function CodexAccountSection({ account }: { account: CodexAccountUsage }) {
  const { t } = useTranslation()
  return (
    <div className='space-y-3 rounded-md border p-4'>
      <p className='text-sm font-medium text-foreground'>{account.accountLabel}</p>
      {account.primary && (
        <UsageBar
          label={t('usage.primary')}
          percent={account.primary.usedPercent}
          reset={`${t('usage.resets')}: ${fmtReset(account.primary.resetAt)}`}
        />
      )}
      {account.secondary && (
        <UsageBar
          label={t('usage.secondary')}
          percent={account.secondary.usedPercent}
          reset={`${t('usage.resets')}: ${fmtReset(account.secondary.resetAt)}`}
        />
      )}
      <div className='text-xs text-muted-foreground'>
        {t('usage.capturedAt')}: {fmtReset(account.capturedAt)}
      </div>
    </div>
  )
}
