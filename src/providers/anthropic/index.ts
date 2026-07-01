/**
 * Anthropic vendor provider. Scrapes platform.claude.com's pricing +
 * models-overview pages so the Refresh button picks up new models
 * (Sonnet 5, Fable 5, ...) and price changes without a redeploy.
 *
 * The build-time script under scripts/scrape-anthropic-prices.ts uses
 * Playwright to render the same Mintlify docs; here we rely on the
 * server-rendered HTML the docs site ships, parsed with regex — no
 * chromium at request time.
 */

import { logger } from '../../logger'
import {
  fetchScrapePage,
  findTables,
  parseContext,
  parsePrice,
  type ScrapedPriceEntry,
  splitCells,
  splitRows,
  VendorProvider
} from '../base'

const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
const OVERVIEW_URL = 'https://platform.claude.com/docs/en/about-claude/models/overview'

// Legacy Claude 3.x dated ids keyed by trimmed display name. Kept in
// sync with scripts/scrape-anthropic-prices.ts LEGACY_IDS.
const LEGACY_IDS: Record<string, string> = {
  'Claude Haiku 3.5': 'claude-3-5-haiku-20241022',
  'Claude Sonnet 3.7': 'claude-3-7-sonnet-20250219',
  'Claude Sonnet 3.5': 'claude-3-5-sonnet-20241022',
  'Claude Haiku 3': 'claude-3-haiku-20240307',
  'Claude Opus 3': 'claude-3-opus-20240229'
}

const orEmpty = (v: string | undefined): string => (v === undefined ? '' : v)

// "Claude Opus 4 (deprecated)" → "Claude Opus 4"
const stripStatus = (display: string): string => display.replace(/\s*\([^)]*\)\s*$/, '').trim()

// "Claude Opus 4.7" → "claude-opus-4-7". "Claude Opus 4" → null: for
// dateless / no-minor rows we prefer the displayToApiId lookup from the
// overview page.
const claude4PlusSlug = (display: string): string | null => {
  const m = display.match(/^Claude\s+(Opus|Sonnet|Haiku)\s+(\d+)\.(\d+)$/i)
  if (m === null) return null
  const major = Number(m[2])
  if (major < 4) return null
  return `claude-${m[1].toLowerCase()}-${major}-${m[3]}`
}

// Extract just the "Claude <Tier> <Major>[.Minor]" prefix, dropping any
// trailing " through August 31, 2026" / " starting September 1, 2026"
// / " (limited availability)" style modifiers the pricing page hangs
// off multi-row models.
const modelPrefix = (display: string): string | null => {
  const m = display.match(/^(Claude\s+(?:Opus|Sonnet|Haiku|Fable|Mythos)\s+\d+(?:\.\d+)?)\b/i)
  return m === null ? null : m[1]
}

interface OverviewMaps {
  displayToApiId: Record<string, string>
  displayToContext: Record<string, number>
}

const emptyOverview: OverviewMaps = { displayToApiId: {}, displayToContext: {} }

const resolveApiId = (display: string, cleaned: string, overview: OverviewMaps): string | undefined => {
  const exact = overview.displayToApiId[display]
  if (exact !== undefined) return exact
  const cleanedHit = overview.displayToApiId[cleaned]
  if (cleanedHit !== undefined) return cleanedHit
  const prefix = modelPrefix(cleaned)
  if (prefix !== null) {
    const prefixHit = overview.displayToApiId[prefix]
    if (prefixHit !== undefined) return prefixHit
    const slug = claude4PlusSlug(prefix)
    if (slug !== null) return slug
    const legacyHit = LEGACY_IDS[prefix]
    if (legacyHit !== undefined) return legacyHit
  }
  const slug = claude4PlusSlug(cleaned)
  if (slug !== null) return slug
  return LEGACY_IDS[cleaned]
}

const recordApiId = (display: string, cell: string | undefined, maps: OverviewMaps): void => {
  if (cell !== undefined && cell !== '') maps.displayToApiId[display] = cell
}

const recordContext = (display: string, cell: string | undefined, maps: OverviewMaps): void => {
  if (cell === undefined) return
  const ctx = parseContext(cell)
  if (ctx !== null) maps.displayToContext[display] = ctx
}

const readOverviewTable = (rows: string[][], maps: OverviewMaps): void => {
  const header = rows[0]
  if (!header.some((c) => /claude/i.test(c))) return
  const apiIdRow = rows.find((r) => /^claude api id$/i.test(orEmpty(r[0])))
  const ctxRow = rows.find((r) => /context\s*window/i.test(orEmpty(r[0])))
  for (let i = 1; i < header.length; i++) {
    const display = header[i]
    if (display === '') continue
    recordApiId(display, apiIdRow === undefined ? undefined : apiIdRow[i], maps)
    recordContext(display, ctxRow === undefined ? undefined : ctxRow[i], maps)
  }
}

const parseOverview = (html: string): OverviewMaps => {
  const maps: OverviewMaps = { displayToApiId: {}, displayToContext: {} }
  for (const table of findTables(html)) {
    const rows = splitRows(table).map(splitCells)
    if (rows.length > 0) readOverviewTable(rows, maps)
  }
  return maps
}

// The pricing page's first <table> is the base-rate model table. We
// locate it by matching column headers rather than table index so a
// future page reorder doesn't silently pick up (e.g.) the Batch table.
const findPricingTable = (html: string): { headers: string[]; rows: string[][] } | null => {
  for (const table of findTables(html)) {
    const rows = splitRows(table).map(splitCells)
    if (rows.length === 0) continue
    const header = rows[0]
    const hasInput = header.some((c) => /base input/i.test(c))
    const hasOutput = header.some((c) => /output tokens/i.test(c))
    const hasModel = header.some((c) => /^model$/i.test(c))
    if (hasInput && hasOutput && hasModel) return { headers: header, rows: rows.slice(1) }
  }
  return null
}

const isLegacyDisplay = (display: string): boolean => /\((deprecated|retired)[^)]*\)/i.test(display)

interface ColumnIndices {
  input: number
  output: number
  cacheRead: number
}

const findColumns = (headers: string[]): ColumnIndices | null => {
  const idx = (label: string): number => headers.findIndex((h) => h.toLowerCase().includes(label.toLowerCase()))
  const input = idx('base input')
  const output = idx('output tokens')
  if (input < 0 || output < 0) return null
  return { input, output, cacheRead: idx('cache hits') }
}

const contextFor = (display: string, cleaned: string, overview: OverviewMaps): number | null => {
  const exact = overview.displayToContext[display]
  if (exact !== undefined) return exact
  const cleanedHit = overview.displayToContext[cleaned]
  if (cleanedHit !== undefined) return cleanedHit
  const prefix = modelPrefix(cleaned)
  if (prefix !== null) {
    const prefixHit = overview.displayToContext[prefix]
    if (prefixHit !== undefined) return prefixHit
  }
  return null
}

const readPriceRow = (row: string[], cols: ColumnIndices, overview: OverviewMaps): ScrapedPriceEntry | null => {
  const display = row[0]
  if (display === undefined || display === '') return null
  const cleaned = stripStatus(display)
  const apiId = resolveApiId(display, cleaned, overview)
  if (apiId === undefined) return null
  const inputPer1M = parsePrice(orEmpty(row[cols.input]))
  const outputPer1M = parsePrice(orEmpty(row[cols.output]))
  if (inputPer1M === null || outputPer1M === null) return null
  const cachedInputPer1M = cols.cacheRead >= 0 ? parsePrice(orEmpty(row[cols.cacheRead])) : null
  return {
    apiId,
    inputPer1M,
    outputPer1M,
    cachedInputPer1M,
    contextWindow: contextFor(display, cleaned, overview),
    legacy: isLegacyDisplay(display)
  }
}

export class AnthropicProvider extends VendorProvider {
  readonly vendor = 'anthropic'
  protected readonly modelsEndpoint = 'https://api.anthropic.com/v1/models'
  protected readonly modelsAuth = 'x-api-key' as const

  async scrape(): Promise<ScrapedPriceEntry[]> {
    const [pricingHtml, overviewHtml] = await Promise.all([fetchScrapePage(PRICING_URL), fetchScrapePage(OVERVIEW_URL)])
    if (pricingHtml === null) return []
    const table = findPricingTable(pricingHtml)
    if (table === null) {
      logger.warn('anthropic scrape: model-pricing table header signature not found')
      return []
    }
    const cols = findColumns(table.headers)
    if (cols === null) {
      logger.warn({ headers: table.headers }, 'anthropic scrape: required columns missing')
      return []
    }
    const overview = overviewHtml === null ? emptyOverview : parseOverview(overviewHtml)
    // De-dup: first row per apiId wins so introductory pricing (e.g.
    // Sonnet 5 through Aug 31, 2026) takes precedence over the
    // "starting September 1" row that follows it.
    const seen = new Set<string>()
    const out: ScrapedPriceEntry[] = []
    for (const row of table.rows) {
      const entry = readPriceRow(row, cols, overview)
      if (entry === null) continue
      if (seen.has(entry.apiId)) continue
      seen.add(entry.apiId)
      out.push(entry)
    }
    return out
  }
}

// Re-export for callers that still import the old service name.
export const scrapeAnthropicPricing = (): Promise<ScrapedPriceEntry[]> => new AnthropicProvider().scrape()
