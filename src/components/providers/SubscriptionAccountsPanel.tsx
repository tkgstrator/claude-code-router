import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatPlan, type SubscriptionView } from '@/lib/providers/subscription-view'
import { findSubscriptionPreset } from '@/shared/data'
import type { Provider } from '@/types'

interface SubscriptionAccountsPanelProps {
  provider: Provider
  providerData: Provider | null
  onProviderDataChange: (next: Provider) => void
  subscriptionByProvider: Record<string, SubscriptionView>
}

// Per-account enable switches for a subscription provider being edited.
// In-flight edits (subscription_accounts on the draft) win over the live
// SubAccount.enabled synced from /subscriptions.
export function SubscriptionAccountsPanel({
  provider,
  providerData,
  onProviderDataChange,
  subscriptionByProvider
}: SubscriptionAccountsPanelProps) {
  const { t } = useTranslation()
  const preset = findSubscriptionPreset(provider)
  const vendor = preset?.vendor ?? 'subscription'
  const cli = preset?.cli ?? ''
  const credentialsPath = preset?.credentialsPath ?? ''
  const sub = subscriptionByProvider[provider.name]
  const accounts = sub?.accounts ?? []
  const editsById = new Map((provider.subscription_accounts ?? []).map((entry) => [entry.id, entry.enabled]))
  const isEnabled = (accountId: string, fallback: boolean): boolean =>
    editsById.has(accountId) ? (editsById.get(accountId) as boolean) : fallback

  return (
    <div className='space-y-3'>
      <div className='bg-muted/40 p-4 text-sm text-foreground space-y-1'>
        <p className='font-medium'>{t('providers.subscription_intro', { vendor, cli })}</p>
        <p className='text-muted-foreground'>{t('providers.subscription_hint', { credentialsPath })}</p>
      </div>
      <div className='space-y-2'>
        <Label>{t('providers.subscription_accounts')}</Label>
        {accounts.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('providers.subscription_no_accounts')}</p>
        ) : (
          <div className='divide-y border-y empty:border-none'>
            {accounts.map((account) => {
              const enabled = isEnabled(account.id, account.enabled)
              return (
                <div key={account.id} className='flex items-center gap-3 px-3 py-2'>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(next) => {
                      if (!providerData) return
                      const baseline: Array<{ id: string; enabled: boolean }> =
                        providerData.subscription_accounts ?? accounts.map((a) => ({ id: a.id, enabled: a.enabled }))
                      const merged = baseline.some((e) => e.id === account.id)
                        ? baseline.map((e) => (e.id === account.id ? { ...e, enabled: next } : e))
                        : [...baseline, { id: account.id, enabled: next }]
                      onProviderDataChange({ ...providerData, subscription_accounts: merged })
                    }}
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-sm truncate'>
                        {account.userName ?? account.userEmail ?? account.userId ?? account.label}
                      </span>
                      {account.plan && (
                        <Badge variant='secondary' className='text-xs uppercase tracking-wide shrink-0'>
                          {formatPlan(account.plan)}
                        </Badge>
                      )}
                    </div>
                    {(account.userEmail || account.userId) && (
                      <div className='text-xs text-muted-foreground truncate'>
                        {account.userEmail ?? account.userId}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
