/**
 * Left rail listing every configured provider, split by how it
 * authenticates.
 *
 * Not `RailItem`: that treatment is a single line of label + icon, and a
 * provider row has to carry the plan, the model count, the health pill and
 * the quota meter. The mock defines this row shape for exactly that
 * reason.
 */
import { Link } from 'react-router-dom'
import { Meter, Pill, RButton } from '@/components/rialto/primitives'
import { cn } from '@/lib/utils'
import { enabledCountOf, listedModelsOf, type ProviderState, planOf, providerQuotaPct, type QuotaIndex } from './derive'
import type { Provider, SubscriptionWire } from './types'

const STATE_TONE = { live: 'ok', invalid: 'bad', unknown: 'mute' } as const

export interface RailProvider {
  provider: Provider
  /** Catalog display name when the vendor is known, else the config slug. */
  label: string
  /** Catalog vendor family, else the host the provider actually calls. */
  vendor: string
  state: ProviderState
  subscription: SubscriptionWire | undefined
}

function ProviderRow({ entry, active, quota }: { entry: RailProvider; active: boolean; quota: QuotaIndex }) {
  const { provider, subscription } = entry
  const plan = planOf(subscription)
  const accountIds = subscription === undefined ? [] : subscription.accounts.map((a) => a.id)
  const pct = providerQuotaPct(quota, accountIds)
  return (
    <Link
      to={`/providers/${encodeURIComponent(provider.name)}`}
      className={cn(
        'block w-full border-l-2 px-4 py-3 text-left transition-colors',
        active ? 'border-l-foreground bg-muted/60' : 'border-l-transparent hover:border-l-border hover:bg-muted/50'
      )}
    >
      <div className='flex items-center gap-2'>
        <span className='text-xs font-medium'>{entry.label}</span>
        {plan === null ? null : <Pill tone='info'>{plan}</Pill>}
        <span className='ml-auto font-mono text-[11px] tabular-nums text-muted-foreground'>
          {enabledCountOf(provider)} / {listedModelsOf(provider).length}
        </span>
      </div>
      <div className='mt-1 flex items-center gap-2 text-[11px] text-muted-foreground'>
        <span>{provider.auth_mode === 'subscription' ? 'OAuth' : 'API key'}</span>
        <span className='opacity-40'>·</span>
        <span>{entry.vendor}</span>
        <span className='ml-auto'>
          <Pill tone={STATE_TONE[entry.state]}>{entry.state}</Pill>
        </span>
      </div>
      {pct === null ? null : (
        <div className='mt-2'>
          <Meter pct={pct} />
        </div>
      )}
    </Link>
  )
}

function RailGroup({
  title,
  entries,
  activeName,
  quota,
  className
}: {
  title: string
  entries: RailProvider[]
  activeName: string | null
  quota: QuotaIndex
  className: string
}) {
  return (
    <>
      <div className={className}>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>{title}</h2>
        <span className='ml-auto font-mono text-[10px] text-muted-foreground'>{entries.length}</span>
      </div>
      {entries.map((entry) => (
        <ProviderRow
          key={entry.provider.name}
          entry={entry}
          active={entry.provider.name === activeName}
          quota={quota}
        />
      ))}
    </>
  )
}

export function ProviderRail({
  entries,
  activeName,
  quota,
  onAdd
}: {
  entries: RailProvider[]
  activeName: string | null
  quota: QuotaIndex
  onAdd: () => void
}) {
  const subscriptions = entries.filter((e) => e.provider.auth_mode === 'subscription')
  const apiKeys = entries.filter((e) => e.provider.auth_mode !== 'subscription')
  return (
    <aside className='min-w-0 overflow-y-auto border-r border-border'>
      <RailGroup
        title='Subscriptions'
        entries={subscriptions}
        activeName={activeName}
        quota={quota}
        className='flex items-center gap-2 px-4 pt-5 pb-2'
      />
      <RailGroup
        title='API keys'
        entries={apiKeys}
        activeName={activeName}
        quota={quota}
        className='mt-2 flex items-center gap-2 border-t border-border px-4 pt-5 pb-2'
      />
      <div className='p-4'>
        <RButton variant='outline' icon='ri-add-line' onClick={onAdd}>
          Add provider
        </RButton>
      </div>
    </aside>
  )
}
