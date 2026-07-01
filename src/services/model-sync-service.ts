/**
 * Refresh the Model catalog for every configured Provider.
 *
 * Two upstream sources per provider are combined:
 *   1. `/v1/models` on the vendor's REST API (needs api key). Adds
 *      any new IDs the shipped seed hadn't caught yet.
 *   2. Scraping the vendor's public pricing page (Anthropic today,
 *      more later). Adds new IDs AND updates per-token prices,
 *      cachedInput, contextWindow, and the legacy flag on rows the
 *      scrape covers — so the UI's cost figures stay in sync with the
 *      vendor's list price without a redeploy.
 *
 * Subscription providers (claude-code, codex) share the vendor catalog
 * of their api_key sibling — the Refresh button surfaces new models on
 * them too, but as `enabled: false` unless they're on the preset's
 * curated defaults list (a normal Pro/Max plan may not entitle the user
 * to the newest model yet).
 */

import type { z } from '@hono/zod-openapi'
import { VENDOR_DEFAULTS } from '@/shared'
import { isDeprecatedModel, SUBSCRIPTION_PRESETS } from '@/shared/data'
import { getPrismaClient } from '../db/client'
import { AuthMode, type Prisma } from '../generated/prisma/client'
import { logger } from '../logger'
import { type RefreshOutcomeSchema, VendorModelsResponseSchema } from '../schemas/model.dto'
import { modelApiStyleOverride } from './config'
import { type ScrapedPriceEntry, scrapeAnthropicPricing } from './vendor-pricing-scraper'

export type RefreshOutcome = z.infer<typeof RefreshOutcomeSchema>

const buildAuth = (
  modelsAuth: NonNullable<(typeof VENDOR_DEFAULTS)[string]['modelsAuth']>,
  apiKey: string,
  url: string
): { url: string; headers: Record<string, string> } => {
  const base: Record<string, string> = { Accept: 'application/json' }
  if (modelsAuth === 'bearer') {
    return { url, headers: { ...base, Authorization: `Bearer ${apiKey}` } }
  }
  if (modelsAuth === 'x-api-key') {
    return { url, headers: { ...base, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }
  }
  return { url: `${url}?key=${encodeURIComponent(apiKey)}`, headers: base }
}

type VendorModelsResponse = z.infer<typeof VendorModelsResponseSchema>

const extractModelIds = (data: VendorModelsResponse): string[] | null => {
  // OpenAI-compatible: { data: [{ id }] }.
  if (Array.isArray(data.data)) {
    return data.data.flatMap((m) => (typeof m.id === 'string' && m.id.length > 0 ? [m.id] : []))
  }
  // Google Gemini: { models: [{ name: "models/gemini-..." }] }.
  if (Array.isArray(data.models)) {
    return data.models.flatMap((m) => {
      if (typeof m.name !== 'string' || m.name.length === 0) return []
      return [m.name.replace(/^models\//, '')]
    })
  }
  return null
}

async function fetchVendorModels(vendor: string, apiKey: string): Promise<string[] | { error: string }> {
  const defaults = VENDOR_DEFAULTS[vendor]
  if (!defaults?.modelsEndpoint || !defaults.modelsAuth) {
    return { error: 'no models endpoint configured for this vendor' }
  }
  const { url, headers } = buildAuth(defaults.modelsAuth, apiKey, defaults.modelsEndpoint)
  const res = await fetch(url, { headers })
  if (!res.ok) return { error: `${vendor} returned HTTP ${res.status}` }
  const parsed = VendorModelsResponseSchema.safeParse(await res.json())
  if (!parsed.success) return { error: `${vendor} returned an unrecognised response shape` }
  const ids = extractModelIds(parsed.data)
  if (ids === null) return { error: `${vendor} returned an unrecognised response shape` }
  return ids
}

// Map a Provider.name back to its "vendor" — the key we use for the
// scrape cache and VENDOR_DEFAULTS lookup. A subscription provider
// (e.g. claude-code) borrows its api_key sibling's vendor identity
// because they hit the same upstream catalog.
const SUBSCRIPTION_VENDOR: Record<string, string> = (() => {
  const acc: Record<string, string> = {}
  for (const preset of SUBSCRIPTION_PRESETS) {
    if (preset.vendor.toLowerCase() === 'anthropic') acc[preset.id] = 'anthropic'
    else if (preset.vendor.toLowerCase() === 'openai') acc[preset.id] = 'openai'
  }
  return acc
})()

const resolveVendor = (providerName: string): string | null => {
  if (providerName in VENDOR_DEFAULTS) return providerName
  const subscriptionVendor = SUBSCRIPTION_VENDOR[providerName]
  return subscriptionVendor === undefined ? null : subscriptionVendor
}

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
// twice per refresh.
async function loadVendorCatalogs(vendors: ReadonlySet<string>): Promise<Map<string, VendorCatalog>> {
  const out = new Map<string, VendorCatalog>()
  if (vendors.has('anthropic')) {
    const scraped = await scrapeAnthropicPricing()
    out.set('anthropic', {
      scraped,
      scrapedById: new Map(scraped.map((s) => [s.apiId, s]))
    })
  }
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
  const got = await fetchVendorModels(p.name, p.apiKey)
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

// Reconcile one Provider's models against the union of the /v1/models
// live list and the vendor's scraped catalog. Returns the outcome to
// report to the UI.
async function refreshOneProvider(p: ProviderRow, catalog: VendorCatalog): Promise<RefreshOutcome> {
  const prisma = getPrismaClient()
  const live = await fetchLiveCatalog(p)
  const desired = new Set<string>([...catalog.scraped.map((s) => s.apiId), ...live.ids])
  if (desired.size === 0) {
    const errorMsg = live.error === undefined ? 'no upstream catalog available' : live.error
    return { provider: p.name, added: [], error: errorMsg }
  }

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

  // Report `error` only when NOTHING was accomplished. A subscription
  // provider that picked up new models via scrape shouldn't be flagged
  // just because it has no api key.
  const succeeded = toAdd.length > 0 || catalog.scraped.length > 0
  return { provider: p.name, added: toAdd, error: succeeded ? undefined : live.error }
}

export async function refreshModelsForAllProviders(): Promise<RefreshOutcome[]> {
  const prisma = getPrismaClient()
  const providers = await prisma.provider.findMany({ include: { models: true } })

  const providerNames = providers.map((p) => p.name)
  const vendorsInPlay = new Set<string>()
  const unresolvedNames: string[] = []
  for (const p of providers) {
    const v = resolveVendor(p.name)
    if (v === null) unresolvedNames.push(p.name)
    else vendorsInPlay.add(v)
  }
  const catalogs = await loadVendorCatalogs(vendorsInPlay)
  logger.info(
    {
      providerCount: providers.length,
      providerNames,
      unresolvedNames,
      vendors: [...vendorsInPlay],
      scrapedCounts: Object.fromEntries([...catalogs].map(([k, v]) => [k, v.scraped.length]))
    },
    'refresh-models: vendor catalogs loaded'
  )

  const results: RefreshOutcome[] = []
  for (const p of providers) {
    const vendor = resolveVendor(p.name)
    const fetched = vendor === null ? undefined : catalogs.get(vendor)
    const catalog: VendorCatalog = fetched === undefined ? emptyCatalog : fetched
    if (vendor === null && catalog.scraped.length === 0) {
      results.push({ provider: p.name, added: [], error: 'unknown vendor' })
      continue
    }
    results.push(await refreshOneProvider(p, catalog))
  }
  return results
}
