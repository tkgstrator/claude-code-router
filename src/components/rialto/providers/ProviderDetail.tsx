/**
 * Detail pane for the provider selected in the rail.
 *
 * One screen for both auth modes, because they differ in exactly three
 * places: a subscription provider shows accounts where an api_key one
 * shows a key, only the api_key one has real per-token prices, and only
 * the api_key one has a model list long enough to need filtering.
 */
import { useState } from 'react'
import { Pill, RButton } from '@/components/rialto/primitives'
import { AccountsPanel } from './AccountsPanel'
import { CredentialsPanel } from './CredentialsPanel'
import { buildModelRows, enabledCountOf, listedModelsOf, type ModelRow, type QuotaIndex } from './derive'
import { ModelsTable } from './ModelsTable'
import { ApiKeyRequestShape, SubscriptionRequestShape } from './RequestShape'
import type { CatalogEntry, Provider, SubscriptionWire, TransformerWire } from './types'

/**
 * Which slice of a long model list to show. The default hides rows that
 * are neither switched on nor priced — on an 18-model vendor those are
 * the ones an operator has already decided against.
 */
type ShowMode = 'priced' | 'enabled' | 'all'

const SHOW_LABEL: Record<ShowMode, string> = {
  priced: 'Enabled + priced',
  enabled: 'Enabled only',
  all: 'All models'
}

const NEXT_SHOW: Record<ShowMode, ShowMode> = { priced: 'enabled', enabled: 'all', all: 'priced' }

const passesShow = (row: ModelRow, mode: ShowMode): boolean => {
  if (mode === 'all') return true
  if (mode === 'enabled') return row.enabled
  return row.enabled || row.inputPer1M !== null || row.outputPer1M !== null
}

/** Rows revealed per press of the footer expander. */
const PAGE = 8

function DetailHeader({
  provider,
  label,
  state,
  busy,
  onTestAll,
  onSync,
  onRemove
}: {
  provider: Provider
  label: string
  state: 'live' | 'invalid' | 'unknown'
  busy: boolean
  onTestAll: () => void
  onSync: () => void
  onRemove: () => void
}) {
  const subscription = provider.auth_mode === 'subscription'
  const stateTone = state === 'live' ? 'ok' : state === 'invalid' ? 'bad' : 'mute'
  return (
    <div className='flex items-center gap-3 border-b border-border px-6 py-4'>
      <div>
        <div className='flex items-center gap-2'>
          <h2 className='text-sm font-semibold'>{label}</h2>
          {subscription ? <Pill tone='info'>subscription</Pill> : <Pill tone='mute'>api key</Pill>}
          <Pill tone={stateTone}>{state}</Pill>
        </div>
        <p className='mt-0.5 font-mono text-[11px] text-muted-foreground'>{provider.api_base_url}</p>
      </div>
      <div className='ml-auto flex gap-2'>
        <RButton variant='outline' icon='ri-pulse-line' onClick={onTestAll} disabled={busy}>
          Test all
        </RButton>
        <RButton variant='ghost' icon='ri-refresh-line' onClick={onSync} disabled={busy}>
          Sync models
        </RButton>
        {subscription ? null : (
          <RButton variant='ghost' icon='ri-delete-bin-line' onClick={onRemove} disabled={busy}>
            Remove
          </RButton>
        )}
      </div>
    </div>
  )
}

function FilterBox({ value, onChange, wide }: { value: string; onChange: (v: string) => void; wide: boolean }) {
  return (
    <div
      className={`flex h-7 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-muted-foreground ${wide ? 'w-44' : ''}`}
    >
      <i className='ri-search-line text-sm' />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={wide ? 'Filter models' : 'Filter'}
        className='min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground'
      />
    </div>
  )
}

function ModelsSection({
  provider,
  rows,
  onToggle
}: {
  provider: Provider
  rows: ModelRow[]
  onToggle: (model: string, next: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<ShowMode>('priced')
  const [limit, setLimit] = useState(PAGE)
  const isApiKey = provider.auth_mode !== 'subscription'

  const needle = query.trim().toLowerCase()
  const filtered = rows.filter((r) => r.name.toLowerCase().includes(needle) && (!isApiKey || passesShow(r, show)))
  // Subscription providers list a curated handful; only the api_key side
  // is long enough that paging earns its footer row.
  const visible = isApiKey ? filtered.slice(0, limit) : filtered
  const hidden = filtered.length - visible.length

  return (
    <>
      <div className='flex items-center gap-3 px-6 pt-5 pb-3'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Models</h3>
        <span className='text-[11px] text-muted-foreground'>
          {enabledCountOf(provider)} of {listedModelsOf(provider).length} enabled
        </span>
        <div className='ml-auto flex items-center gap-2'>
          {isApiKey ? (
            <button
              type='button'
              onClick={() => setShow(NEXT_SHOW[show])}
              className='inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-muted/60'
            >
              <span className='text-muted-foreground'>Show</span> {SHOW_LABEL[show]}
              <i className='ri-arrow-down-s-line text-sm text-muted-foreground' />
            </button>
          ) : null}
          <FilterBox value={query} onChange={setQuery} wide={isApiKey} />
        </div>
      </div>
      <ModelsTable rows={visible} withOverride={isApiKey} onToggle={onToggle} />
      {hidden > 0 ? (
        <div className='px-6 py-4'>
          <button
            type='button'
            onClick={() => setLimit(limit + PAGE)}
            className='w-full rounded-md border border-dashed border-border py-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50'
          >
            Show {hidden} more models
          </button>
        </div>
      ) : null}
      <div className={isApiKey ? 'h-6' : 'h-8'} />
    </>
  )
}

export interface ProviderDetailProps {
  provider: Provider
  /** Catalog display name when the vendor is known, else the config slug. */
  label: string
  state: 'live' | 'invalid' | 'unknown'
  subscription: SubscriptionWire | undefined
  catalogEntry: CatalogEntry | undefined
  transformers: TransformerWire[]
  quota: QuotaIndex
  now: number
  busy: boolean
  onToggleModel: (model: string, next: boolean) => void
  onSaveKey: (key: string) => void
  onTestAll: () => void
  onSync: () => void
  onRemove: () => void
}

export function ProviderDetail(props: ProviderDetailProps) {
  const { provider, subscription, catalogEntry, transformers, quota, now } = props
  const subscriptionMode = provider.auth_mode === 'subscription'
  const rows = buildModelRows(provider, catalogEntry)
  return (
    <div className='min-w-0 overflow-y-auto'>
      <DetailHeader
        provider={provider}
        label={props.label}
        state={props.state}
        busy={props.busy}
        onTestAll={props.onTestAll}
        onSync={props.onSync}
        onRemove={props.onRemove}
      />
      <div className='grid grid-cols-2 border-b border-border'>
        {subscriptionMode ? (
          <AccountsPanel subscription={subscription} quota={quota} now={now} />
        ) : (
          <CredentialsPanel key={provider.name} provider={provider} label={props.label} onSave={props.onSaveKey} />
        )}
        {subscriptionMode ? (
          <SubscriptionRequestShape provider={provider} transformers={transformers} />
        ) : (
          <ApiKeyRequestShape provider={provider} />
        )}
      </div>
      {/* Keyed on the provider: the filter, the Show mode and how far the
          list has been expanded are all about THIS provider's models. */}
      <ModelsSection key={provider.name} provider={provider} rows={rows} onToggle={props.onToggleModel} />
    </div>
  )
}
