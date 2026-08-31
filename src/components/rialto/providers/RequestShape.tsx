/**
 * Read-only "what does this provider actually speak" block.
 *
 * There is nothing to pick here: the wire shape is a function of apiStyle
 * + authMode, and every registered transformer is endpoint- or auth-bound
 * and takes no options. It is shown because the answer is the first thing
 * worth knowing when a request misbehaves.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { apiStyleOf, authLabelOf, endpointOf, pipelineOf } from './derive'
import type { Provider, TransformerWire } from './types'

function ShapeRow({ label, value, accent }: { label: string; value: string; accent: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline gap-3 py-1.5',
        accent ? 'border-l-2 border-l-transparent transition-colors hover:border-l-border' : ''
      )}
    >
      <span className='text-[11px] text-muted-foreground'>{label}</span>
      <span className='ml-auto font-mono text-[11px]'>{value}</span>
    </div>
  )
}

function Frame({ pad, children }: { pad: string; children: ReactNode }) {
  return (
    <div>
      <div className='px-6 pt-5 pb-2'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Request shape</h3>
      </div>
      <div className={pad}>{children}</div>
    </div>
  )
}

const shapeValues = (p: Provider) => {
  const style = apiStyleOf(p)
  const pipeline = pipelineOf(p)
  return {
    style: style === null ? '—' : style,
    auth: authLabelOf(p),
    pipeline: pipeline.length === 0 ? '—' : pipeline.join(' → ')
  }
}

/** Subscription providers also show the endpoint — they have no key block above to carry the URL. */
export function SubscriptionRequestShape({
  provider,
  transformers
}: {
  provider: Provider
  transformers: TransformerWire[]
}) {
  const v = shapeValues(provider)
  const endpoint = endpointOf(provider, transformers)
  return (
    <Frame pad='px-6 pb-4'>
      <ShapeRow label='API style' value={v.style} accent />
      <ShapeRow label='Auth' value={v.auth} accent />
      <ShapeRow label='Pipeline' value={v.pipeline} accent />
      <ShapeRow label='Endpoint' value={endpoint === null ? '—' : endpoint} accent />
      <p className='mt-3 text-[11px] leading-relaxed text-muted-foreground'>
        Derived from the API style — not configurable. Per-model overrides live in the model row below.
      </p>
    </Frame>
  )
}

/** Distinct per-model request-shape overrides, for the footnote. */
function overrideStyles(provider: Provider): string[] {
  const map = provider.modelApiStyles === undefined ? {} : provider.modelApiStyles
  const distinct = new Set(Object.values(map).filter((s) => s !== provider.api_style))
  return [...distinct]
}

export function ApiKeyRequestShape({ provider }: { provider: Provider }) {
  const v = shapeValues(provider)
  const overrides = overrideStyles(provider)
  return (
    <Frame pad='px-6 pb-5'>
      <ShapeRow label='API style' value={v.style} accent={false} />
      <ShapeRow label='Auth' value={v.auth} accent={false} />
      <ShapeRow label='Pipeline' value={v.pipeline} accent={false} />
      <p className='mt-3 text-[11px] leading-relaxed text-muted-foreground'>
        Derived from the API style — not configurable.
        {overrides.length === 0 ? null : (
          <>
            {' '}
            Some models here override to <span className='font-mono'>{overrides.join(', ')}</span>; see the Override
            column.
          </>
        )}
      </p>
    </Frame>
  )
}
