/**
 * Refresh the Model catalog for every configured Provider.
 *
 * Two upstream sources per provider are combined:
 *   1. `/v1/models` on the vendor's REST API (needs api key). Adds
 *      any new IDs the shipped seed hadn't caught yet.
 *   2. Scraping the vendor's public pricing page (anthropic / openai /
 *      deepseek / codex today). Adds new IDs AND updates per-token
 *      prices, cachedInput, contextWindow, and the legacy flag on rows
 *      the scrape covers — so the UI's cost figures stay in sync with
 *      the vendor's list price without a redeploy.
 *
 * All vendor-specific plumbing lives under providers/<vendor>/; this
 * service just orchestrates. Subscription providers (claude-code,
 * codex) resolve to the same VendorProvider instance as their api_key
 * sibling in the registry, so they share the scrape output without a
 * second HTTP hit.
 */

import type { z } from '@hono/zod-openapi'
import { isDeprecatedModel, LLM_PRICES_SEED, SUBSCRIPTION_PRESETS } from '@/shared/data'
import { getPrismaClient } from '../db/client'
import { AuthMode, type Prisma } from '../generated/prisma/client'
import { logger } from '../logger'
import type { ScrapedPriceEntry } from '../providers/base'
import { getVendorProvider, isScrapedVendor } from '../providers/registry'
import type { RefreshOutcomeSchema } from '../schemas/api/models'
import { modelApiStyleOverride } from './config'

export type RefreshOutcome = z.infer<typeof RefreshOutcomeSchema>

// Per-vendor list of models that should ship as enabled on a fresh
// subscription provider. Refresh only auto-enables when a newly
// discovered id is on this list — otherwise the row lands disabled and
// the user opts in.
const subscriptionDefaultsById = (providerName: string): ReadonlySet<string> => {
  const preset = SUBSCRIPTION_PRESETS.find((p) => p.id === providerName)
  return new Set(preset === undefined ? [] : preset.defaultEnabledModels)
}

const modelDataFromScrape = (entry: ScrapedPriceEntry) => ({
  legacy: entry.legacy,
  inputPer1M: entry.inputPer1M,
  outputPer1M: entry.outputPer1M,
  cachedInputPer1M: entry.cachedInputPer1M,
  contextWindow: entry.contextWindow
})

interface VendorCatalog {
  scraped: ScrapedPriceEntry[]
  scrapedById: Map<string, ScrapedPriceEntry>
}

const emptyCatalog: VendorCatalog = { scraped: [], scrapedById: new Map() }

// Fetch every vendor scrape once up front so multiple providers that
// share a vendor (e.g. anthropic + claude-code) don't hit the docs site
// twice per refresh. Only vendors with a native scraper are queried;
// generic-fallback vendors return [] anyway.
async function loadVendorCatalogs(providerNames: ReadonlySet<string>): Promise<Map<string, VendorCatalog>> {
  const scrapedTargets = [...providerNames].filter((n) => isScrapedVendor(n))
  const out = new Map<string, VendorCatalog>()
  await Promise.all(
    scrapedTargets.map(async (name) => {
      const provider = getVendorProvider(name)
      if (provider === undefined) return
      const scraped = await provider.scrape()
      out.set(name, { scraped, scrapedById: new Map(scraped.map((s) => [s.apiId, s])) })
    })
  )
  return out
}

interface ProviderRow {
  id: string
  name: string
  apiKey: string | null
  authMode: AuthMode
  models: { name: string }[]
}

// Compute the initial `enabled` for a fresh row. api_key providers
// enable everything but legacy/deprecated (mirrors price-seed-service).
// Subscription providers only auto-enable ids on the preset's curated
// defaultEnabledModels list — a Pro/Max plan may not entitle the user
// to the newest model.
const initialEnabled = (
  authMode: AuthMode,
  name: string,
  deprecated: boolean,
  legacy: boolean,
  defaults: ReadonlySet<string>
): boolean => {
  if (authMode === AuthMode.subscription) return defaults.has(name)
  return !(deprecated || legacy)
}

const buildCreateRow = (
  name: string,
  p: ProviderRow,
  scr: ScrapedPriceEntry | undefined,
  defaults: ReadonlySet<string>
): Prisma.ModelCreateManyInput => {
  const deprecated = isDeprecatedModel(name)
  const legacy = scr === undefined ? false : scr.legacy
  return {
    providerId: p.id,
    name,
    deprecated,
    legacy,
    enabled: initialEnabled(p.authMode, name, deprecated, legacy, defaults),
    inputPer1M: scr === undefined ? null : scr.inputPer1M,
    outputPer1M: scr === undefined ? null : scr.outputPer1M,
    cachedInputPer1M: scr === undefined ? null : scr.cachedInputPer1M,
    contextWindow: scr === undefined ? null : scr.contextWindow,
    apiStyle: modelApiStyleOverride(name)
  }
}

interface LiveFetchResult {
  ids: string[]
  error: string | undefined
}

// Live catalog from /v1/models. Skip for subscription providers or any
// api_key provider without a key on file.
async function fetchLiveCatalog(p: ProviderRow): Promise<LiveFetchResult> {
  if (p.authMode !== AuthMode.api_key) return { ids: [], error: undefined }
  if (p.apiKey === null || p.apiKey.trim() === '') {
    return { ids: [], error: 'no api key on file' }
  }
  const provider = getVendorProvider(p.name)
  if (provider === undefined) return { ids: [], error: 'unknown vendor' }
  const got = await provider.fetchLiveModels(p.apiKey)
  if (Array.isArray(got)) return { ids: got, error: undefined }
  return { ids: [], error: got.error }
}

// Sync price/context/legacy on rows the scrape covers. Never touches
// Model.enabled — that's the user's toggle.
async function applyScrapedPrices(
  p: ProviderRow,
  catalog: VendorCatalog,
  existing: ReadonlySet<string>
): Promise<void> {
  const prisma = getPrismaClient()
  for (const scr of catalog.scraped) {
    if (!existing.has(scr.apiId)) continue
    await prisma.model.update({
      where: { providerId_name: { providerId: p.id, name: scr.apiId } },
      data: modelDataFromScrape(scr)
    })
  }
}

// Bring the `deprecated` flag on previously-seeded rows in line with
// the shared deprecations registry.
async function syncDeprecationFlags(p: ProviderRow, allCurrentNames: string[]): Promise<void> {
  const prisma = getPrismaClient()
  const flipToDeprecated = allCurrentNames.filter(isDeprecatedModel)
  const flipToActive = allCurrentNames.filter((n) => !isDeprecatedModel(n))
  if (flipToDeprecated.length > 0) {
    await prisma.model.updateMany({
      where: { providerId: p.id, name: { in: flipToDeprecated }, deprecated: false },
      data: { deprecated: true }
    })
  }
  if (flipToActive.length > 0) {
    await prisma.model.updateMany({
      where: { providerId: p.id, name: { in: flipToActive }, deprecated: true },
      data: { deprecated: false }
    })
  }
}

// Ask the vendor to look up per-model contextWindow from its docs pages
// for every id CCR knows about (DB rows ∪ freshly-added rows). Runs
// regardless of whether the pricing scrape or /v1/models returned
// anything — subscription providers with an empty live catalog still
// get their existing rows' context refreshed. Values the vendor returns
// overwrite the current DB value; missing ids are left alone.
async function refreshContextWindows(p: ProviderRow, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const provider = getVendorProvider(p.name)
  if (provider === undefined) return 0
  const contexts = await provider.fetchContextWindows(ids)
  if (contexts.size === 0) return 0
  const prisma = getPrismaClient()
  for (const [name, contextWindow] of contexts) {
    await prisma.model.update({
      where: { providerId_name: { providerId: p.id, name } },
      data: { contextWindow }
    })
  }
  return contexts.size
}

// Reconcile one Provider's models against the union of the /v1/models
// live list and the vendor's scraped catalog. Returns the outcome to
// report to the UI.
async function refreshOneProvider(p: ProviderRow, catalog: VendorCatalog): Promise<RefreshOutcome> {
  const prisma = getPrismaClient()
  const live = await fetchLiveCatalog(p)
  const desired = new Set<string>([...catalog.scraped.map((s) => s.apiId), ...live.ids])
  const existing = new Set(p.models.map((m) => m.name))
  const toAdd = [...desired].filter((id) => !existing.has(id))
  const defaults = subscriptionDefaultsById(p.name)

  if (toAdd.length > 0) {
    const rows: Prisma.ModelCreateManyInput[] = toAdd.map((name) =>
      buildCreateRow(name, p, catalog.scrapedById.get(name), defaults)
    )
    await prisma.model.createMany({ data: rows, skipDuplicates: true })
  }

  await applyScrapedPrices(p, catalog, existing)
  await syncDeprecationFlags(p, [...existing, ...toAdd])

  // Contextwindow refresh runs against DB rows ∪ freshly added, so a
  // subscription provider with no pricing/live catalog still gets its
  // existing rows' context refreshed against the vendor's per-model
  // docs pages.
  const contextsUpdated = await refreshContextWindows(p, Array.from(new Set([...existing, ...toAdd])))

  // Report `error` only when NOTHING was accomplished. A subscription
  // provider that picked up new models via scrape (or refreshed the
  // contextWindow of existing ones) shouldn't be flagged just because
  // it has no api key.
  const succeeded = toAdd.length > 0 || catalog.scraped.length > 0 || contextsUpdated > 0
  if (!succeeded) {
    const errorMsg = live.error === undefined ? 'no upstream catalog available' : live.error
    return { provider: p.name, added: [], error: errorMsg }
  }
  return { provider: p.name, added: toAdd, error: undefined }
}

// Which scrape bucket to consult for a given Provider. Subscription
// providers borrow their api_key sibling's vendor (claude-code →
// anthropic, codex → openai) so they share the same scrape output.
const scrapeVendorFor = (providerName: string): string | null => {
  if (isScrapedVendor(providerName)) return providerName
  const preset = SUBSCRIPTION_PRESETS.find((p) => p.id === providerName)
  if (preset === undefined) return null
  const v = preset.vendor.toLowerCase()
  if (v === 'anthropic') return 'anthropic'
  if (v === 'openai') return 'openai'
  return null
}

export async function refreshModelsForAllProviders(): Promise<RefreshOutcome[]> {
  const prisma = getPrismaClient()
  const providers = await prisma.provider.findMany({ include: { models: true } })

  const providerNames = providers.map((p) => p.name)
  const scrapeVendors = new Set<string>()
  for (const p of providers) {
    const v = scrapeVendorFor(p.name)
    if (v !== null) scrapeVendors.add(v)
  }
  const catalogs = await loadVendorCatalogs(scrapeVendors)
  logger.info(
    {
      providerCount: providers.length,
      providerNames,
      scrapeVendors: [...scrapeVendors],
      scrapedCounts: Object.fromEntries([...catalogs].map(([k, v]) => [k, v.scraped.length]))
    },
    'refresh-models: vendor catalogs loaded'
  )

  const results: RefreshOutcome[] = []
  for (const p of providers) {
    const scrapeVendor = scrapeVendorFor(p.name)
    const fetched = scrapeVendor === null ? undefined : catalogs.get(scrapeVendor)
    const catalog: VendorCatalog = fetched === undefined ? emptyCatalog : fetched
    results.push(await refreshOneProvider(p, catalog))
  }
  await backfillStaticPrices()
  return results
}

// Fill in prices from the bundled llm-prices.json snapshot for any model
// the live scrape didn't cover (vendors without a scraper — qwen, xai,
// mistral, …). Only touches rows whose inputPer1M is still null, so
// scraped / already-set prices win. This makes the DB the single source
// of truth the UI reads (via provider.modelPrices), so the frontend needs
// no static-pricing fallback of its own.
async function backfillStaticPrices(): Promise<void> {
  const prisma = getPrismaClient()
  for (const p of LLM_PRICES_SEED.prices) {
    await prisma.model.updateMany({
      where: { name: p.id, inputPer1M: null },
      data: { inputPer1M: p.input, outputPer1M: p.output, cachedInputPer1M: p.input_cached }
    })
  }
}
