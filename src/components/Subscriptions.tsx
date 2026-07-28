import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { SubscriptionAuthBadge } from '@/components/usage/AuthBadge'
import { api } from '@/lib/api'
import { fmtCost } from '@/lib/usage/format'
import type { SubscriptionAccount, SubscriptionProvider, SubscriptionsResponse } from '@/lib/usage/types'

const REFRESH_MS = 5 * 60_000

interface ProviderCost {
  provider: string
  totalCostUsd: number | null
  isSubscription: boolean
  subscriptionMonthlyUsd: number | null
}
interface UsageCostResponse {
  providers: ProviderCost[]
  days: number
}

type Translator = (k: string, opts?: Record<string, unknown>) => string

function AccountRow({ account, t }: { account: SubscriptionAccount; t: Translator }) {
  const subtitle = [account.userName, account.userEmail].filter(Boolean).join(' · ')
  return (
    <div className='flex items-center justify-between gap-3 border-t px-1 py-3 first:border-t-0'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate text-sm font-medium'>{account.label}</span>
          <SubscriptionAuthBadge account={account} />
          {!account.enabled && (
            <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
              {t('subscriptions.disabled')}
            </span>
          )}
        </div>
        {subtitle && <div className='truncate text-xs text-muted-foreground'>{subtitle}</div>}
      </div>
      <div className='flex flex-col items-end gap-0.5 text-right'>
        {account.plan && <span className='text-xs text-muted-foreground'>{account.plan}</span>}
        {account.monthlyPriceUsd != null && (
          <span className='text-sm font-medium'>${account.monthlyPriceUsd.toFixed(0)}/mo</span>
        )}
      </div>
    </div>
  )
}

function ProviderCard({
  provider,
  apiCostUsd,
  t
}: {
  provider: SubscriptionProvider
  apiCostUsd: number | null
  t: Translator
}) {
  const monthlyUsd = provider.accounts.find((a) => a.monthlyPriceUsd != null)?.monthlyPriceUsd ?? null
  const savingsUsd = apiCostUsd != null && monthlyUsd != null ? apiCostUsd - monthlyUsd : null
  return (
    <section>
      <div className='flex items-center justify-between border-b px-1 pb-2'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>{provider.providerName}</span>
          {provider.activeAccount && (
            <span className='rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600'>
              {t('subscriptions.activeLabel')}: {provider.activeAccount.label}
            </span>
          )}
        </div>
        {monthlyUsd != null && <span className='text-xs text-muted-foreground'>${monthlyUsd.toFixed(0)}/mo</span>}
      </div>
      {provider.accounts.length === 0 ? (
        <div className='px-1 py-3 text-xs text-muted-foreground'>{t('subscriptions.noAccounts')}</div>
      ) : (
        <div>
          {provider.accounts.map((acc) => (
            <AccountRow key={acc.id} account={acc} t={t} />
          ))}
        </div>
      )}
      {monthlyUsd != null && (
        <div className='flex items-center justify-between border-t px-1 py-2 text-xs text-muted-foreground'>
          <span>
            {t('usage.apiCostPeriod30d')} API:{' '}
            <span className='font-medium text-foreground'>{fmtCost(apiCostUsd, t('usage.apiCostNoPricing'))}</span>
          </span>
          {savingsUsd != null ? (
            <span
              className={
                savingsUsd > 0 ? 'font-medium text-green-600' : savingsUsd < 0 ? 'font-medium text-red-500' : ''
              }
            >
              {savingsUsd > 0
                ? t('usage.apiCostSaved', { amount: fmtCost(savingsUsd, '') })
                : savingsUsd < 0
                  ? t('usage.apiCostOver', { amount: fmtCost(-savingsUsd, '') })
                  : t('usage.apiCostBreakEven')}
            </span>
          ) : (
            <span className='italic'>{t('usage.apiCostSyncNeeded')}</span>
          )}
        </div>
      )}
    </section>
  )
}

export function Subscriptions() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [subData, setSubData] = useState<SubscriptionsResponse | null>(null)
  const [costData, setCostData] = useState<UsageCostResponse | null>(null)
  const [syncing, setSyncing] = useState(false)

  const fetchAll = () => {
    api
      .get<SubscriptionsResponse>('/subscriptions')
      .then(setSubData)
      .catch(() => setSubData({ subscriptions: [] }))
    api
      .get<UsageCostResponse>('/usage/cost?days=30')
      .then(setCostData)
      .catch(() => setCostData({ providers: [], days: 30 }))
  }

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.post('/subscriptions/sync', {})
      fetchAll()
    } catch {
      // ignore
    } finally {
      setSyncing(false)
    }
  }

  const costByProvider = new Map((costData?.providers ?? []).map((p) => [p.provider, p.totalCostUsd]))
  const providers = subData?.subscriptions ?? []

  return (
    <PageContainer>
      <PageHeader title={t('nav.subscriptions')}>
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' onClick={() => navigate('/providers')}>
            {t('providers.title')}
          </Button>
          <Button variant='outline' size='sm' onClick={() => navigate('/usage')}>
            {t('nav.usage')}
          </Button>
          <Button variant='outline' size='sm' onClick={handleSync} disabled={syncing}>
            {syncing ? '…' : t('usage.sync')}
          </Button>
        </div>
      </PageHeader>
      <PageContent>
        <p className='text-xs text-muted-foreground'>{t('subscriptions.usageHint')}</p>

        {providers.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('subscriptions.empty')}</p>
        ) : (
          // Auto-fill grid so provider cards sit side-by-side at a comfortable
          // width on wide screens instead of stacking full-width rows.
          <div className='grid grid-cols-[repeat(auto-fill,minmax(24rem,1fr))] items-start gap-x-8 gap-y-6'>
            {providers.map((p) => (
              <ProviderCard
                key={p.providerName}
                provider={p}
                apiCostUsd={costByProvider.get(p.providerName) ?? null}
                t={t}
              />
            ))}
          </div>
        )}
      </PageContent>
    </PageContainer>
  )
}
