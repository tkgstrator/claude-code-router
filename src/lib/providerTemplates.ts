import { buildSeedPricing } from '@/shared/data'

/**
 * Model pricing surfaced to the UI.
 *
 * Sourced from the shared llm-prices snapshot
 * (src/shared/data/llm-prices.json). The same data is used by the
 * server-side seed routine, so the UI's price labels and the initial DB
 * contents always agree.
 */

export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  contextWindow?: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = buildSeedPricing()
