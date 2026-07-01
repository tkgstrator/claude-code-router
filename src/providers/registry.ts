/**
 * Registry of every vendor provider CCR knows how to talk to.
 * `model-sync-service` and `catalog-service` iterate over this map to
 * refresh prices + models; the DB's Provider.name is looked up here
 * to route to the right subclass.
 *
 * Adding a new vendor is a single line: `.set('name', new NewProvider())`.
 * Static fallback data (VENDOR_DEFAULTS / OFFICIAL_VENDOR_PRICES) is
 * still consulted by the config seed layer, but the runtime scrape +
 * live models path goes exclusively through this registry.
 */

import { VENDOR_DEFAULTS } from '@/shared'
import { AnthropicProvider } from './anthropic'
import type { VendorProvider } from './base'
import { CodexProvider } from './codex'
import { DeepSeekProvider } from './deepseek'
import { GenericProvider } from './generic'
import { OpenAIProvider } from './openai'

const anthropic = new AnthropicProvider()
const explicitRegistry = new Map<string, VendorProvider>()
explicitRegistry.set('anthropic', anthropic)
explicitRegistry.set('openai', new OpenAIProvider())
explicitRegistry.set('deepseek', new DeepSeekProvider())
explicitRegistry.set('codex', new CodexProvider())

// The `claude-code` subscription provider borrows anthropic's catalog
// (same models, subscription-billed instead of per-token). It reuses
// the AnthropicProvider instance directly — same scrape output, same
// modelsEndpoint (though the subscription path won't hit it because
// there's no apiKey to send).
explicitRegistry.set('claude-code', anthropic)

// Cache generic fallbacks so we don't rebuild them on every lookup.
const genericCache = new Map<string, VendorProvider>()

// Vendor names that have a native scraper. Callers use this to decide
// whether to bother invoking scrape() at all — everyone else uses the
// generic fallback whose scrape() returns [].
const SCRAPED_VENDORS = new Set(['anthropic', 'openai', 'deepseek', 'codex'])

export const getVendorProvider = (name: string): VendorProvider | undefined => {
  const explicit = explicitRegistry.get(name)
  if (explicit !== undefined) return explicit
  const cached = genericCache.get(name)
  if (cached !== undefined) return cached
  // Only fall back if VENDOR_DEFAULTS knows this vendor; otherwise we
  // have no idea how to reach it.
  if (!(name in VENDOR_DEFAULTS)) return undefined
  const generic = new GenericProvider(name)
  genericCache.set(name, generic)
  return generic
}

export const isScrapedVendor = (name: string): boolean => SCRAPED_VENDORS.has(name)
