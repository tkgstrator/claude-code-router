/**
 * Vendor-published official pricing per provider, in USD per 1M tokens.
 *
 * Each `providers/<vendor>/prices.json` is the canonical source for
 * that vendor's official rates. The shape is intentionally trivial so
 * the per-vendor scraper scripts under `scripts/scrape-<vendor>-prices.ts`
 * can regenerate them without touching code. Vendor entries are
 * overlaid on top of the third-party llm-prices.json snapshot in
 * `buildSeedPricing` — see ../index.ts.
 *
 * Currently shipped:
 *   - openai     (developers.openai.com/api/docs/pricing)
 *   - anthropic  (platform.claude.com/docs/en/about-claude/pricing)
 *   - google     (ai.google.dev/gemini-api/docs/pricing — empty pending scraper)
 */

import anthropic from './anthropic/prices.json'
import google from './google/prices.json'
import openai from './openai/prices.json'

export interface OfficialPricingEntry {
  inputPer1M: number
  outputPer1M: number
  /** True when the model appears under the vendor's "legacy" / "deprecated" surface on its pricing page. */
  legacy?: boolean
}

export interface VendorPriceFile {
  vendor: string
  source: string
  lastChecked: string
  notes?: string[]
  prices: Record<string, { input: number; output: number; legacy?: boolean }>
}

const FILES: VendorPriceFile[] = [openai, anthropic, google] as VendorPriceFile[]

const buildLookup = (): Record<string, Record<string, OfficialPricingEntry>> => {
  const out: Record<string, Record<string, OfficialPricingEntry>> = {}
  for (const file of FILES) {
    const vendorMap: Record<string, OfficialPricingEntry> = {}
    for (const [id, entry] of Object.entries(file.prices)) {
      const out: OfficialPricingEntry = { inputPer1M: entry.input, outputPer1M: entry.output }
      if (entry.legacy) out.legacy = true
      vendorMap[id] = out
    }
    out[file.vendor] = vendorMap
  }
  return out
}

// Flat set of every model id flagged legacy across vendors — handy for
// merging into the deprecation registry without dragging vendor names
// around at the call site.
export const LEGACY_MODELS: ReadonlySet<string> = (() => {
  const set = new Set<string>()
  for (const file of FILES) {
    for (const [id, entry] of Object.entries(file.prices)) {
      if (entry.legacy) set.add(id)
    }
  }
  return set
})()

export const OFFICIAL_VENDOR_PRICES: Record<string, Record<string, OfficialPricingEntry>> = buildLookup()
export const VENDOR_PRICE_FILES: VendorPriceFile[] = FILES
