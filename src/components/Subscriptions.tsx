import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'

const REFRESH_MS = 5 * 60_000

const CLAUDE_SUBSCRIBE_URL = 'https://claude.ai'
const CODEX_SUBSCRIBE_URL = 'https://chatgpt.com'

interface ClaudeWindow {
  utilization: number
  resetsAt: string | null
}
interface CodexWindow {
  usedPercent: number
  resetAt: string | null
  windowSeconds: number | null
}
interface ClaudeAccountUsage {
  accountLabel: string
  fiveHour: ClaudeWindow | null
  sevenDay: ClaudeWindow | null
  sevenDaySonnet: ClaudeWindow | null
  sevenDayOpus: ClaudeWindow | null
  extraUsageEnabled: boolean
  capturedAt: string
}
interface CodexAccountUsage {
  accountLabel: string
  planType: string | null
  primary: CodexWindow | null
  secondary: CodexWindow | null
  capturedAt: string
}
interface UsageResponse {
  claude: ClaudeAccountUsage[]
  codex: CodexAccountUsage[]
}

interface ModelCost {
  model: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCostUsd: number | null
}
interface ProviderCost {
  provider: string
  models: ModelCost[]
  totalCostUsd: number | null
  isSubscription: boolean
  subscriptionMonthlyUsd: number | null
}
interface UsageCostResponse {
  providers: ProviderCost[]
  days: number
}

const fmtReset = (iso: string | null): string => {
  if (!iso) return '—'
  const d = dayjs(iso)
  return d.isValid() ? d.format('YYYY/MM/DD HH:mm') : iso
}

const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

const fmtCost = (usd: number | null, noPricingLabel: string): string => {
  if (usd === null) return noPricingLabel
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function UsageBar({ label, percent, reset }: { label: string; percent: number; reset: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between text-sm'>
        <span className='font-medium'>{label}</span>
        <span className='text-muted-foreground'>{percent.toFixed(1)}%</span>
      </div>
      <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
        <div className='h-full rounded-full bg-blue-500' style={{ width: `${clamped}%` }} />
      </div>
      <div className='text-xs text-muted-foreground'>{reset}</div>
    </div>
  )
}

function NotRegistered({ message, hint, href, cta }: { message: string; hint: string; href: string; cta: string }) {
  return (
    <div className='space-y-1 text-sm text-muted-foreground'>
      <p>{message}</p>
      <p className='text-xs'>{hint}</p>
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='inline-block text-xs font-medium text-primary hover:underline'
      >
        {cta}
      </a>
    </div>
  )
}

function ClaudeAccountSection({ account, t }: { account: ClaudeAccountUsage; t: (k: string) => string }) {
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

function CodexAccountSection({ account, t }: { account: CodexAccountUsage; t: (k: string) => string }) {
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

export function Subscriptions() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [costData, setCostData] = useState<UsageCostResponse | null>(null)

  const fetchUsage = () => {
    api
      .get<UsageResponse>('/usage')
      .then(setData)
      .catch(() => setError(true))
  }

  const fetchCost = () => {
    api
      .get<UsageCostResponse>('/usage/cost?days=30')
      .then(setCostData)
      .catch(() => setCostData({ providers: [], days: 30 }))
  }

  useEffect(() => {
    fetchUsage()
    fetchCost()
    const id = setInterval(() => {
      fetchUsage()
      fetchCost()
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.post('/subscriptions/sync', {})
      fetchUsage()
      fetchCost()
    } catch {
      // ignore sync errors silently
    } finally {
      setSyncing(false)
    }
  }

  const subscriptionProviders = costData?.providers.filter((p) => p.isSubscription) ?? []

  return (
    <PageContainer>
      <PageHeader title={t('nav.subscriptions')}>
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' onClick={() => navigate('/providers')}>
            {t('providers.title')}
          </Button>
          <Button variant='outline' size='sm' onClick={handleSync} disabled={syncing}>
            {syncing ? '…' : t('usage.sync')}
          </Button>
        </div>
      </PageHeader>
      <PageContent className='space-y-6'>
        {error && <div className='text-sm text-red-500'>{t('usage.loadError')}</div>}

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('usage.claude')}</h3>
          {data?.claude.length === 0 ? (
            <NotRegistered
              message={t('usage.claudeNotRegistered')}
              hint={t('usage.claudeNotRegisteredHint')}
              href={CLAUDE_SUBSCRIBE_URL}
              cta={t('usage.openSubscriptionPage')}
            />
          ) : (
            <div className='space-y-3'>
              {data?.claude.map((account) => (
                <ClaudeAccountSection key={account.accountLabel} account={account} t={t} />
              ))}
            </div>
          )}
        </section>

        <section className='space-y-3'>
          <h3 className='text-sm font-semibold'>{t('usage.codex')}</h3>
          {data?.codex.length === 0 ? (
            <NotRegistered
              message={t('usage.codexNotRegistered')}
              hint={t('usage.codexNotRegisteredHint')}
              href={CODEX_SUBSCRIBE_URL}
              cta={t('usage.openSubscriptionPage')}
            />
          ) : (
            <div className='space-y-3'>
              {data?.codex.map((account) => (
                <CodexAccountSection key={account.accountLabel} account={account} t={t} />
              ))}
            </div>
          )}
        </section>

        {subscriptionProviders.length > 0 && (
          <section className='space-y-3'>
            <h3 className='text-sm font-semibold'>{t('usage.subscriptionSavings')}</h3>
            <div className='space-y-3'>
              {subscriptionProviders.map((p) => {
                const days = 30
                const proratedSubUsd = p.subscriptionMonthlyUsd != null ? p.subscriptionMonthlyUsd * (days / 30) : null
                const savingsUsd =
                  p.totalCostUsd != null && proratedSubUsd != null ? p.totalCostUsd - proratedSubUsd : null
                return (
                  <div key={p.provider} className='rounded-md border'>
                    <div className='flex items-center justify-between border-b px-4 py-2'>
                      <span className='text-sm font-medium'>{p.provider}</span>
                      {p.subscriptionMonthlyUsd != null && (
                        <span className='text-xs text-muted-foreground'>${p.subscriptionMonthlyUsd.toFixed(0)}/mo</span>
                      )}
                    </div>
                    <div className='flex items-center justify-between px-4 py-2 text-xs text-muted-foreground'>
                      <span>
                        {t('usage.apiCostPeriod30d')} API:{' '}
                        <span className='font-medium text-foreground'>
                          {fmtCost(p.totalCostUsd, t('usage.apiCostNoPricing'))}
                        </span>
                      </span>
                      {proratedSubUsd != null ? (
                        <span
                          className={
                            savingsUsd != null && savingsUsd > 0
                              ? 'font-medium text-green-600'
                              : savingsUsd != null && savingsUsd < 0
                                ? 'font-medium text-red-500'
                                : ''
                          }
                        >
                          {savingsUsd != null
                            ? savingsUsd > 0
                              ? t('usage.apiCostSaved', { amount: fmtCost(savingsUsd, '') })
                              : savingsUsd < 0
                                ? t('usage.apiCostOver', { amount: fmtCost(-savingsUsd, '') })
                                : t('usage.apiCostBreakEven')
                            : fmtCost(proratedSubUsd, '')}
                        </span>
                      ) : (
                        <span className='italic'>{t('usage.apiCostSyncNeeded')}</span>
                      )}
                    </div>
                    {proratedSubUsd != null && (
                      <div className='border-t px-4 py-2 text-xs text-muted-foreground'>
                        {t('usage.apiCostSubProrated', {
                          price: `$${p.subscriptionMonthlyUsd!.toFixed(0)}/mo`,
                          days
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </PageContent>
    </PageContainer>
  )
}
