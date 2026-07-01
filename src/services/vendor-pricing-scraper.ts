/**
 * Runtime scraper for vendor pricing pages. Powers the UI's Refresh
 * button so users pick up brand-new models (e.g. Claude Sonnet 5) and
 * price/context changes without waiting for a redeploy.
 *
 * Anthropic only for now. The build-time script under
 * scripts/scrape-anthropic-prices.ts uses Playwright to render the
 * Mintlify docs — at runtime we can't (won't) launch chromium per
 * request, so we `fetch()` the raw HTML and parse the pricing table
 * with a targeted regex. The tables are server-rendered, so this works.
 *
 * If the page layout changes, the parser returns `[]` for that source
 * rather than throwing — the refresh flow then falls back to the
 * `/v1/models` behaviour that already ships.
 */
import { logger } from '../logger'

const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
const OVERVIEW_URL = 'https://platform.claude.com/docs/en/about-claude/models/overview'

export interface ScrapedPriceEntry {
  apiId: string
  inputPer1M: number
  outputPer1M: number
  cachedInputPer1M: number | null
  contextWindow: number | null
  legacy: boolean
}

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

// Strip HTML tags and normalise whitespace. Cells embed <br/>, <a>,
// nested <span>s; we only need the visible text.
const cellText = (raw: string): string =>
  raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const matchAllGroups = (html: string, pattern: RegExp): string[] => [...html.matchAll(pattern)].map((m) => m[1])

const splitRows = (tableHtml: string): string[] => matchAllGroups(tableHtml, /<tr[^>]*>([\s\S]*?)<\/tr>/gi)

const splitCells = (rowHtml: string): string[] =>
  matchAllGroups(rowHtml, /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi).map(cellText)

const findTables = (html: string): string[] => matchAllGroups(html, /<table[^>]*>([\s\S]*?)<\/table>/gi)

// "200K" → 200000, "1M tokens" → 1000000. Takes the first number so
// "200K (1M with beta)" resolves to the standard window.
const parseContext = (raw: string): number | null => {
  const m = raw.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*([KM])?/i)
  if (m === null) return null
  const n = Number(m[1])
  const unit = orEmpty(m[2]).toUpperCase()
  if (unit === 'M') return Math.round(n * 1e6)
  if (unit === 'K') return Math.round(n * 1e3)
  return Math.round(n)
}

// "$5 / MTok" → 5, "$0.50 / MTok" → 0.5, "—" → null.
const parsePrice = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-' || trimmed === '—') return null
  const m = trimmed.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/)
  return m !== null ? Number(m[1]) : null
}

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
// off multi-row models. Returns null if the display doesn't start with
// a Claude model name at all.
const modelPrefix = (display: string): string | null => {
  const m = display.match(/^(Claude\s+(?:Opus|Sonnet|Haiku|Fable|Mythos)\s+\d+(?:\.\d+)?)\b/i)
  return m === null ? null : m[1]
}

// Resolve the API id for a pricing-table row. Priority: exact overview
// mapping, cleaned overview mapping, model-prefix overview mapping,
// slug rule, hard-coded legacy list.
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

async function fetchHtml(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      // Mintlify's pricing page renders the tables inline in the SSR
      // HTML; a bare Node fetch UA gets the same payload as a browser.
      'User-Agent': 'Mozilla/5.0 (compatible; ccr-refresh-models/1.0)',
      Accept: 'text/html'
    }
  })
  if (!res.ok) {
    logger.warn({ url, status: res.status }, 'vendor pricing fetch: non-2xx')
    return null
  }
  return await res.text()
}

interface OverviewMaps {
  displayToApiId: Record<string, string>
  displayToContext: Record<string, number>
}

const emptyOverview: OverviewMaps = { displayToApiId: {}, displayToContext: {} }

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

// Extract (display → api id) and (display → context window) from every
// table on the overview page whose header row mentions any Claude model.
// The current page ships one primary comparison table plus a legacy
// accordion table; both use the same column-per-model layout.
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
    if (hasInput && hasOutput && hasModel) {
      return { headers: header, rows: rows.slice(1) }
    }
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

/**
 * Scrape platform.claude.com's pricing + overview pages. Returns an
 * empty array on any parse/network failure — the caller falls back to
 * whatever else it has.
 */
export async function scrapeAnthropicPricing(): Promise<ScrapedPriceEntry[]> {
  const [pricingHtml, overviewHtml] = await Promise.all([fetchHtml(PRICING_URL), fetchHtml(OVERVIEW_URL)])
  if (pricingHtml === null) return []
  const table = findPricingTable(pricingHtml)
  if (table === null) {
    logger.warn('vendor pricing scrape: model-pricing table header signature not found')
    return []
  }
  const cols = findColumns(table.headers)
  if (cols === null) {
    logger.warn({ headers: table.headers }, 'vendor pricing scrape: required columns missing')
    return []
  }
  const overview = overviewHtml === null ? emptyOverview : parseOverview(overviewHtml)
  // De-dup: the first row per apiId wins so introductory pricing (e.g.
  // Sonnet 5 through Aug 31, 2026) takes precedence over the "starting
  // September 1" row that follows it.
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
