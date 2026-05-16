import seed from './llm-prices.json'

export const LLM_PRICES_URL = 'https://www.llm-prices.com/current-v1.json'

export interface PriceEntry {
  id: string
  vendor: string
  name: string
  input: number
  output: number
  input_cached: number | null
}

export interface PriceSnapshot {
  updated_at: string
  prices: PriceEntry[]
}

export const LLM_PRICES_SEED = seed as PriceSnapshot

export interface VendorDefaults {
  /** Provider.apiBaseUrl */
  baseUrl: string
  /** Provider.transformer JSONB; absent for openai-compatible vendors */
  transformer?: { use: string[] }
}

// Vendors absent from this map are skipped: we can't infer a safe public
// endpoint for them (e.g. amazon needs per-region Bedrock signing).
export const VENDOR_DEFAULTS: Record<string, VendorDefaults> = {
  anthropic: { baseUrl: 'https://api.anthropic.com/v1/messages' },
  deepseek: { baseUrl: 'https://api.deepseek.com/chat/completions', transformer: { use: ['deepseek'] } },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/', transformer: { use: ['gemini'] } },
  minimax: { baseUrl: 'https://api.minimax.chat/v1/text/chatcompletion_v2' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1/chat/completions' },
  'moonshot-ai': { baseUrl: 'https://api.moonshot.cn/v1/chat/completions' },
  openai: { baseUrl: 'https://api.openai.com/v1/chat/completions' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' },
  xai: { baseUrl: 'https://api.x.ai/v1/chat/completions' }
}

/**
 * One Provider per vendor with all its models, ready to feed into either
 * the UI template combobox or a DB seed. Vendors with no
 * VENDOR_DEFAULTS entry are skipped.
 */
export interface SeedProvider {
  name: string
  apiBaseUrl: string
  models: string[]
  transformer?: { use: string[] }
}

export function buildSeedProviders(prices: PriceEntry[] = LLM_PRICES_SEED.prices): SeedProvider[] {
  // Set per vendor — upstream lists the same id once per pricing tier
  // (e.g. xai's grok-4-fast appears for 32k and 128k context) and the
  // DB's Model.(providerId, name) unique constraint rejects dups.
  const byVendor = new Map<string, Set<string>>()
  for (const p of prices) {
    const set = byVendor.get(p.vendor) ?? new Set<string>()
    set.add(p.id)
    byVendor.set(p.vendor, set)
  }
  const result: SeedProvider[] = []
  for (const [vendor, modelSet] of byVendor) {
    const defaults = VENDOR_DEFAULTS[vendor]
    if (!defaults) continue
    result.push({
      name: vendor,
      apiBaseUrl: defaults.baseUrl,
      models: [...modelSet],
      ...(defaults.transformer ? { transformer: defaults.transformer } : {})
    })
  }
  return result
}

export interface PricingEntry {
  inputPer1M: number
  outputPer1M: number
}

export function buildSeedPricing(prices: PriceEntry[] = LLM_PRICES_SEED.prices): Record<string, PricingEntry> {
  const result: Record<string, PricingEntry> = {}
  for (const p of prices) {
    result[p.id] = { inputPer1M: p.input, outputPer1M: p.output }
  }
  return result
}
