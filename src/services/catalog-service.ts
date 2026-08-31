/**
 * Assemble the "provider catalog" — the read-only reference view of
 * every vendor CCR knows about, with its models and prices, plus
 * whether the user has enabled it (i.e. a Provider row exists).
 *
 * The catalog fuses three sources:
 *   1. Static seed shipped in @/shared/data:
 *        - VENDOR_DEFAULTS      → api_key vendor list + base URLs
 *        - SUBSCRIPTION_PRESETS → subscription vendor list (claude-code, codex)
 *        - OFFICIAL_VENDOR_PRICES → per-model prices scraped at build time
 *   2. A runtime scrape overlay for anthropic (see vendor-pricing-scraper.ts).
 *      Held in process memory; a restart falls back to the static seed
 *      until the next refresh call.
 *   3. The DB's Provider.name set, used to flip each entry's `enabled`
 *      flag.
 *
 * The catalog is intentionally not persisted to the DB. The Provider /
 * Model tables represent the user's opt-in state; the catalog is a
 * view over reference data.
 */

import type { z } from '@hono/zod-openapi'
import type { OfficialPricingEntry } from '@/shared/data'
import { isDeprecatedModel, OFFICIAL_VENDOR_PRICES, SUBSCRIPTION_PRESETS, VENDOR_DEFAULTS } from '@/shared/data'
import { getPrismaClient } from '../db/client'
import dayjs from '../lib/dayjs'
import type { ScrapedPriceEntry } from '../providers/base'
import { getVendorProvider, scrapedVendors } from '../providers/registry'
import type { CatalogEntrySchema, CatalogModelSchema } from '../schemas/api/catalog'
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>
export type CatalogModel = z.infer<typeof CatalogModelSchema>

// In-process overlay: newest scrape wins over the static seed for that
// vendor. Cleared on server restart; the /api/catalog GET falls back to
// static data until a refresh is triggered.
interface Overlay {
  vendor: string
  scrapedAt: string
  entries: Map<string, ScrapedPriceEntry>
}
const overlayByVendor = new Map<string, Overlay>()

const modelFromStatic = (name: string, entry: OfficialPricingEntry): CatalogModel => ({
  name,
  inputPer1M: entry.inputPer1M,
  outputPer1M: entry.outputPer1M,
  cachedInputPer1M: entry.cachedInputPer1M === undefined ? null : entry.cachedInputPer1M,
  contextWindow: entry.contextWindow === undefined ? null : entry.contextWindow,
  legacy: entry.legacy === true,
  deprecated: isDeprecatedModel(name)
})

const modelFromScraped = (scraped: ScrapedPriceEntry): CatalogModel => ({
  name: scraped.apiId,
  inputPer1M: scraped.inputPer1M,
  outputPer1M: scraped.outputPer1M,
  cachedInputPer1M: scraped.cachedInputPer1M,
  contextWindow: scraped.contextWindow,
  legacy: scraped.legacy,
  deprecated: isDeprecatedModel(scraped.apiId)
})

// Fuse static prices (SEED) + runtime overlay for one vendor. Overlay
// takes precedence for models present in both; overlay-only ids are
// appended. Names emitted in sorted order for a stable UI.
const modelsForVendor = (vendor: string): CatalogModel[] => {
  const staticMap = OFFICIAL_VENDOR_PRICES[vendor]
  const overlay = overlayByVendor.get(vendor)
  const out = new Map<string, CatalogModel>()
  if (staticMap !== undefined) {
    for (const [name, entry] of Object.entries(staticMap)) {
      const scraped = overlay === undefined ? undefined : overlay.entries.get(name)
      out.set(name, scraped === undefined ? modelFromStatic(name, entry) : modelFromScraped(scraped))
    }
  }
  if (overlay !== undefined) {
    for (const [name, scraped] of overlay.entries) {
      if (!out.has(name)) out.set(name, modelFromScraped(scraped))
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const lastRefreshedForVendor = (vendor: string): string | null => {
  const overlay = overlayByVendor.get(vendor)
  return overlay === undefined ? null : overlay.scrapedAt
}

interface CatalogSeed {
  name: string
  displayName: string
  authMode: 'api_key' | 'subscription'
  apiBaseUrl: string
  vendor: string
  cli: string | null
  credentialsPath: string | null
  defaultEnabledModels: string[]
  modelsVendor: string
}

// Which OFFICIAL_VENDOR_PRICES bucket to consult for this catalog entry.
// Subscription providers borrow their api_key sibling's price list
// (claude-code → anthropic, codex → openai).
const modelsVendorFor = (name: string, authMode: 'api_key' | 'subscription'): string => {
  if (authMode === 'api_key') return name
  const preset = SUBSCRIPTION_PRESETS.find((p) => p.id === name)
  if (preset === undefined) return name
  const v = preset.vendor.toLowerCase()
  if (v === 'anthropic') return 'anthropic'
  if (v === 'openai') return 'openai'
  return name
}

const seeds = (): CatalogSeed[] => {
  const out: CatalogSeed[] = []
  for (const name of Object.keys(VENDOR_DEFAULTS)) {
    const defaults = VENDOR_DEFAULTS[name]
    out.push({
      name,
      displayName: name,
      authMode: 'api_key',
      apiBaseUrl: defaults.baseUrl,
      vendor: name,
      cli: null,
      credentialsPath: null,
      defaultEnabledModels: [],
      modelsVendor: modelsVendorFor(name, 'api_key')
    })
  }
  for (const preset of SUBSCRIPTION_PRESETS) {
    out.push({
      name: preset.id,
      displayName: preset.label,
      authMode: 'subscription',
      apiBaseUrl: preset.apiBaseUrl,
      vendor: preset.vendor,
      cli: preset.cli,
      credentialsPath: preset.credentialsPath,
      defaultEnabledModels: [...preset.defaultEnabledModels],
      modelsVendor: modelsVendorFor(preset.id, 'subscription')
    })
  }
  return out
}

// Filter catalog models to those the subscription preset advertises.
// Subscription plans expose a curated subset of the vendor's catalog
// (e.g. claude-code Pro doesn't ship mythos), and hiding the rest keeps
// the "Available" section from listing models the user's plan can't run.
const filterSubscriptionModels = (
  models: CatalogModel[],
  preset: (typeof SUBSCRIPTION_PRESETS)[number]
): CatalogModel[] => {
  const available = new Set(preset.availableModels)
  return models.filter((m) => available.has(m.name))
}

const buildEntry = (seed: CatalogSeed, enabled: boolean): CatalogEntry => {
  const rawModels = modelsForVendor(seed.modelsVendor)
  const preset = seed.authMode === 'subscription' ? SUBSCRIPTION_PRESETS.find((p) => p.id === seed.name) : undefined
  const models = preset === undefined ? rawModels : filterSubscriptionModels(rawModels, preset)
  return {
    name: seed.name,
    displayName: seed.displayName,
    authMode: seed.authMode,
    apiBaseUrl: seed.apiBaseUrl,
    vendor: seed.vendor,
    cli: seed.cli,
    credentialsPath: seed.credentialsPath,
    defaultEnabledModels: seed.defaultEnabledModels,
    models,
    enabled,
    lastRefreshedAt: lastRefreshedForVendor(seed.modelsVendor)
  }
}

export async function getCatalog(): Promise<CatalogEntry[]> {
  const prisma = getPrismaClient()
  const providers = await prisma.provider.findMany({ select: { name: true } })
  const enabledNames = new Set(providers.map((p) => p.name))
  return seeds().map((seed) => buildEntry(seed, enabledNames.has(seed.name)))
}

export interface CatalogRefreshResult {
  entries: CatalogEntry[]
  scrapedVendors: string[]
  warnings: string[]
}

// Trigger a live scrape for every vendor with a scraper implementation,
// update the process-local overlay, then return the fresh catalog view.
// The user's enabled providers are NOT touched here — this endpoint is
// catalog-only. Refreshing Model rows on configured providers is the
// job of /api/refresh-models.
export async function refreshCatalog(): Promise<CatalogRefreshResult> {
  const scrapedList: string[] = []
  const warnings: string[] = []
  const now = dayjs().toISOString()
  await Promise.all(
    scrapedVendors().map(async (vendor) => {
      const provider = getVendorProvider(vendor)
      if (provider === undefined) return
      const scraped = await provider.scrape()
      if (scraped.length === 0) {
        warnings.push(`${vendor}: scrape returned no entries; static seed retained`)
        return
      }
      overlayByVendor.set(vendor, {
        vendor,
        scrapedAt: now,
        entries: new Map(scraped.map((s) => [s.apiId, s]))
      })
      scrapedList.push(vendor)
    })
  )
  const entries = await getCatalog()
  return { entries, scrapedVendors: scrapedList, warnings }
}
