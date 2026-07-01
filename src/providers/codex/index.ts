/**
 * Codex vendor provider — subscription path. Scrapes the "Credits per
 * 1M tokens" table on developers.openai.com/codex/pricing to keep the
 * available-model list current.
 *
 * Codex bills in credits, not dollars, so this scraper never populates
 * inputPer1M / outputPer1M — those columns land as null on every row.
 * The value delivered is knowing what model ids the subscription can
 * currently serve without having to touch SUBSCRIPTION_PRESETS on
 * every launch.
 *
 * `modelsEndpoint` is null: the ChatGPT Codex backend doesn't expose a
 * /v1/models list, so fetchLiveModels returns the "not configured"
 * error shape.
 */

import { logger } from '../../logger'
import { fetchScrapePage, findTables, type ScrapedPriceEntry, splitCells, splitRows, VendorProvider } from '../base'

const PRICING_URL = 'https://developers.openai.com/codex/pricing'

// Whitelisted suffix words the pricing table appends to a model name.
// A hyphen followed by anything outside this set is treated as prose
// bleed-through (e.g. "gpt-5.5 usage averages 5-45 credits per
// message") rather than a real model id, and the row is skipped.
const VALID_SUFFIX = /^(mini|nano|pro|codex|spark)$/i

// Convert the pricing page's display label into the API model id used
// on the request wire. The table header cells are "GPT-5.5",
// "GPT-5.4 mini", "GPT-5.3-Codex-Spark", ...; the API surface expects
// lower-case with dots for the version and hyphens for size/family
// modifiers.
const displayToApiId = (raw: string): string | null => {
  const s = raw.trim().toLowerCase()
  if (s === '') return null
  // Strip after any parenthetical or newline explanation.
  const trimmed = s.replace(/\s*[(–—-]\s*(image|text|research.*)$/i, '').trim()
  const m = trimmed.match(/^gpt-([0-9]+\.[0-9]+)([\s-][a-z0-9\-\s]+)?$/i)
  if (m === null) return null
  const version = m[1]
  const rawSuffix = m[2] === undefined ? '' : m[2].trim()
  if (rawSuffix === '') return `gpt-${version}`
  // Split on whitespace / hyphens; each token must be an allowed suffix
  // word. Reject prose (e.g. "gpt-5.5 usage averages ...").
  const tokens = rawSuffix.split(/[\s-]+/).filter((t) => t !== '')
  if (!tokens.every((t) => VALID_SUFFIX.test(t))) return null
  return `gpt-${version}-${tokens.join('-')}`
}

interface CodexTable {
  headers: string[]
  rows: string[][]
}

// Locate the "Credits per 1M tokens" table specifically — the page
// carries several look-alike tables covering session limits (Local
// Messages / Cloud Tasks per 5h). Header signature: first cell mentions
// "Credits per 1M tokens".
const findCreditsTable = (html: string): CodexTable | null => {
  for (const table of findTables(html)) {
    const rows = splitRows(table).map(splitCells)
    if (rows.length < 2) continue
    const header = rows[0]
    if (header.length === 0) continue
    if (!/credits\s*per\s*1M\s*tokens/i.test(header[0])) continue
    return { headers: header, rows: rows.slice(1) }
  }
  return null
}

const orEmpty = (v: string | undefined): string => (v === undefined ? '' : v)

const readRow = (row: string[]): ScrapedPriceEntry | null => {
  const apiId = displayToApiId(orEmpty(row[0]))
  if (apiId === null) return null
  // Codex credits don't translate to dollar/token, so leave every price
  // column null. Downstream UI shows the model as "subscription-priced"
  // rather than "$X / 1M".
  return {
    apiId,
    inputPer1M: null,
    outputPer1M: null,
    cachedInputPer1M: null,
    contextWindow: null,
    legacy: false
  }
}

export class CodexProvider extends VendorProvider {
  readonly vendor = 'codex'
  protected readonly modelsEndpoint = null
  protected readonly modelsAuth = null

  async scrape(): Promise<ScrapedPriceEntry[]> {
    const html = await fetchScrapePage(PRICING_URL)
    if (html === null) return []
    const table = findCreditsTable(html)
    if (table === null) {
      logger.warn('codex scrape: credits-per-1M-tokens table not found')
      return []
    }
    const seen = new Set<string>()
    const out: ScrapedPriceEntry[] = []
    for (const row of table.rows) {
      const entry = readRow(row)
      if (entry === null) continue
      if (seen.has(entry.apiId)) continue
      seen.add(entry.apiId)
      out.push(entry)
    }
    return out
  }
}
