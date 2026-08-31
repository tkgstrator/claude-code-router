/**
 * Step 3 of the add-provider flow: pick what the new provider may serve.
 *
 * Reuses the detail screen's model table rather than inventing a second
 * treatment — it is the same decision, made once before the provider takes
 * traffic instead of after.
 */
import { Pill } from '@/components/rialto/primitives'
import { buildModelRows, enabledCountOf, listedModelsOf } from './derive'
import { ModelsTable } from './ModelsTable'
import type { CatalogEntry, Provider } from './types'
import { vendorLabel } from './vendor-labels'

export function ConnectModelsStep({
  entry,
  provider,
  onToggle
}: {
  entry: CatalogEntry
  provider: Provider | undefined
  onToggle: (model: string, next: boolean) => void
}) {
  if (provider === undefined) {
    return (
      <div className='min-w-0 overflow-y-auto'>
        <div className='px-6 py-6 text-xs text-muted-foreground'>
          {vendorLabel(entry.name, entry.displayName)} has not been added yet. Finish step 2 first.
        </div>
      </div>
    )
  }
  const isApiKey = provider.auth_mode !== 'subscription'
  return (
    <div className='min-w-0 overflow-y-auto'>
      <div className='border-b border-border px-6 py-4'>
        <div className='flex items-center gap-2'>
          <h2 className='text-sm font-semibold'>{vendorLabel(entry.name, entry.displayName)}</h2>
          {isApiKey ? <Pill tone='mute'>api key</Pill> : <Pill tone='info'>subscription</Pill>}
        </div>
        <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>
          Only the models switched on here can be routed to. The rest stay listed so you can turn them on later without
          re-adding the vendor.
        </p>
      </div>
      <div className='flex items-center gap-3 px-6 pt-5 pb-3'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Models</h3>
        <span className='text-[11px] text-muted-foreground'>
          {enabledCountOf(provider)} of {listedModelsOf(provider).length} enabled
        </span>
      </div>
      <ModelsTable rows={buildModelRows(provider, entry)} withOverride={isApiKey} onToggle={onToggle} />
      <div className='h-6' />
    </div>
  )
}
