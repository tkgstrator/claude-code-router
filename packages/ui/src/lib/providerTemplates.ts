import type { Provider } from '@/types'
import seed from '@/data/llm-prices.json'

/**
 * Built-in provider templates and pricing.
 *
 * Sourced from a snapshot of https://www.llm-prices.com/current-v1.json
 * stored at src/data/llm-prices.json. Generating templates from that
 * snapshot keeps the model list aligned with the price table and avoids
 * the uncontrolled external dependency the upstream fork used (a
 * musistudio-managed Cloudflare R2 bucket). A "refresh" UI action can
 * later override these values at runtime from the same source.
 */

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPer1M: number
  /** USD per 1M output tokens */
  outputPer1M: number
}

interface PriceEntry {
  id: string
  vendor: string
  name: string
  input: number
  output: number
  input_cached: number | null
}

interface PriceSnapshot {
  updated_at: string
  prices: PriceEntry[]
}

const snapshot = seed as PriceSnapshot

interface VendorDefaults {
  baseUrl: string
  transformer?: Provider['transformer']
}

// Vendor → API base URL / transformer. Vendors absent here are skipped
// because we can't reasonably default their endpoint (e.g. amazon
// requires per-region Bedrock signing). Add an entry when a sane public
// default exists.
const VENDOR_DEFAULTS: Record<string, VendorDefaults> = {
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

export function buildTemplates(prices: PriceEntry[]): Provider[] {
  const byVendor = new Map<string, string[]>()
  for (const p of prices) {
    const list = byVendor.get(p.vendor) ?? []
    list.push(p.id)
    byVendor.set(p.vendor, list)
  }
  const result: Provider[] = []
  for (const [vendor, models] of byVendor) {
    const defaults = VENDOR_DEFAULTS[vendor]
    if (!defaults) continue
    result.push({
      name: vendor,
      api_base_url: defaults.baseUrl,
      api_key: '',
      models,
      ...(defaults.transformer ? { transformer: defaults.transformer } : {})
    })
  }
  return result
}

export function buildPricing(prices: PriceEntry[]): Record<string, ModelPricing> {
  const result: Record<string, ModelPricing> = {}
  for (const p of prices) {
    result[p.id] = { inputPer1M: p.input, outputPer1M: p.output }
  }
  return result
}

export const PRICES_UPDATED_AT: string = snapshot.updated_at
export const PROVIDER_TEMPLATES: Provider[] = buildTemplates(snapshot.prices)
export const MODEL_PRICING: Record<string, ModelPricing> = buildPricing(snapshot.prices)

export const LLM_PRICES_URL = 'https://www.llm-prices.com/current-v1.json'
