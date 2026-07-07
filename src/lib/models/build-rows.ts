import { MODEL_PRICING } from '@/shared/data'
import type { Provider } from '@/types'
import type { ModelRow, SortKey } from './types'

// Flatten enabled providers' models into one row per (provider, model),
// skipping providers that are disabled or have no usable credential yet
// (a subscription provider needs an active plan; an api_key provider needs
// a non-empty key).
export function buildModelRows(providers: Provider[], planByProvider: Record<string, string | null>): ModelRow[] {
  return providers.flatMap((provider) => {
    if (!provider) return []
    const providerName = provider.name || 'unknown'
    if (provider.enabled === false) return []
    const providerAvailable =
      provider.auth_mode === 'subscription'
        ? Boolean(planByProvider[providerName])
        : (provider.api_key?.trim().length ?? 0) > 0
    if (!providerAvailable) return []
    const models = Array.isArray(provider.models) ? provider.models : []
    const disabledList = Array.isArray(provider.transformer?._disabledModels)
      ? provider.transformer._disabledModels
      : []
    const isSubscription = provider.auth_mode === 'subscription'
    const deprecatedSet = new Set(provider.deprecatedModels ?? [])
    const ctxMap = provider.modelContextWindows ?? {}
    return models.map((model) => {
      const key = `${providerName},${model}`
      const enabled = !disabledList.includes(model)
      const deprecated = deprecatedSet.has(model)
      return { provider: providerName, model, key, enabled, isSubscription, deprecated, contextWindow: ctxMap[model] }
    })
  })
}

function priceOf(model: string, which: 'inputPer1M' | 'outputPer1M'): number {
  return MODEL_PRICING[model]?.[which] ?? Number.POSITIVE_INFINITY
}

// No active sort: keep the natural order — providers in config order,
// models in their per-provider order. We used to fall through to an
// alphabetical model tiebreak here, which surfaced "openai
// chatgpt-4o-latest" at the top because 'cha' < 'cla'.
export function sortModelRows(rows: ModelRow[], sortKey: SortKey | null, sortDir: 'asc' | 'desc'): ModelRow[] {
  if (!sortKey) return rows
  const sign = sortDir === 'asc' ? 1 : -1
  const primary = (row: ModelRow) => {
    if (sortKey === 'input') return priceOf(row.model, 'inputPer1M')
    if (sortKey === 'output') return priceOf(row.model, 'outputPer1M')
    return row[sortKey]
  }
  // Stable sort on primary only — ties preserve raw (provider-grouped,
  // config-ordered) order, so sorting by Provider doesn't reorder the
  // models inside each group.
  return [...rows].sort((a, b) => {
    const av = primary(a)
    const bv = primary(b)
    if (av < bv) return -1 * sign
    if (av > bv) return 1 * sign
    return 0
  })
}
