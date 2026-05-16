import {
  buildSeedPricing,
  buildSeedProviders,
  LLM_PRICES_URL,
  type PriceEntry,
  type SeedProvider
} from '@ccr/shared'
import type { Provider } from '@/types'

/**
 * Provider templates / model pricing surfaced to the UI.
 *
 * Sourced from the shared llm-prices snapshot
 * (packages/shared/src/data/llm-prices.json). The same data is used by
 * the server-side seed routine, so the UI Add-Provider dropdown and the
 * initial DB contents always agree.
 *
 * The refresh button in the dialog refetches the upstream JSON at
 * runtime and feeds it back through buildTemplates.
 */

export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
}

const toUiProvider = (seed: SeedProvider): Provider => ({
  name: seed.name,
  api_base_url: seed.apiBaseUrl,
  api_key: '',
  models: seed.models,
  ...(seed.transformer ? { transformer: seed.transformer } : {})
})

export function buildTemplates(prices: PriceEntry[]): Provider[] {
  return buildSeedProviders(prices).map(toUiProvider)
}

export const PROVIDER_TEMPLATES: Provider[] = buildSeedProviders().map(toUiProvider)
export const MODEL_PRICING: Record<string, ModelPricing> = buildSeedPricing()

export { LLM_PRICES_URL }
