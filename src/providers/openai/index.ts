/**
 * OpenAI vendor provider — api_key path. Scrapes the flagship LLM
 * pricing table at developers.openai.com/api/docs/pricing.
 *
 * The page ships four tables in the SSR HTML (Standard, Batch, Flex,
 * Priority). Only the Standard tier matches per-token API billing;
 * Batch and Flex are cheaper variants that only apply on those specific
 * endpoints, so we skip them. Tables are located by their header
 * signature ("Model", "Input", "Cached input", "Output") rather than by
 * index, so a page reorder can't silently pull the wrong tier.
 *
 * The header row wraps Short-context and Long-context columns under a
 * spanned "Short context" / "Long context" super-header; we always take
 * the short-context columns because that's what unmarked model calls
 * bill at.
 *
 * Codex-family and image / audio models live on separate pricing pages
 * (see providers/codex/index.ts) — this scraper ignores those tables.
 */

import { logger } from '../../logger'
import {
  fetchScrapePage,
  findTables,
  parsePrice,
  type ScrapedPriceEntry,
  splitCells,
  splitRows,
  VendorProvider
} from '../base'

const PRICING_URL = 'https://developers.openai.com/api/docs/pricing'

interface OpenAiTable {
  headers: string[]
  rows: string[][]
}

// Locate the Standard LLM table: signature is "Model" column plus a
// short-context Input + Cached input + Output triple. The first table
// on the page that matches wins; downstream tiers (Batch, Flex,
// Priority) use the same signature but are ordered after.
const findStandardTable = (html: string): OpenAiTable | null => {
  for (const table of findTables(html)) {
    const rows = splitRows(table).map(splitCells)
    if (rows.length < 2) continue
    // Header row is the second physical row: the first spans the
    // Short/Long context super-header.
    const header = rows[1]
    const hasModel = header.some((c) => /^model$/i.test(c))
    const hasInput = header.some((c) => /^input$/i.test(c))
    const hasCached = header.some((c) => /^cached input$/i.test(c))
    const hasOutput = header.some((c) => /^output$/i.test(c))
    if (hasModel && hasInput && hasCached && hasOutput) {
      return { headers: header, rows: rows.slice(2) }
    }
  }
  return null
}

// The pricing page's short-context columns come first: Model, Input,
// Cached input, Output. Long-context columns repeat the same triple
// (Input, Cached input, Output) after. Index the short block.
interface Columns {
  model: number
  input: number
  cachedInput: number
  output: number
}

const findColumns = (headers: string[]): Columns | null => {
  const model = headers.findIndex((h) => /^model$/i.test(h))
  if (model < 0) return null
  const input = headers.findIndex((h, i) => i > model && /^input$/i.test(h))
  const cachedInput = headers.findIndex((h, i) => i > input && /^cached input$/i.test(h))
  const output = headers.findIndex((h, i) => i > cachedInput && /^output$/i.test(h))
  if (input < 0 || cachedInput < 0 || output < 0) return null
  return { model, input, cachedInput, output }
}

const orEmpty = (v: string | undefined): string => (v === undefined ? '' : v)

// gpt model ids on the pricing page are already the API-facing form
// (gpt-5.5, gpt-4.1-nano, ...). Whitespace-only or notes cells return null.
const cleanModelId = (raw: string): string | null => {
  const s = raw.trim()
  if (s === '' || s === '—' || s === '-') return null
  // A row like "gpt-5.5 (research preview)" — keep just the id.
  const m = s.match(/^([a-z0-9][a-z0-9.\-_]*)/i)
  return m === null ? null : m[1]
}

const readRow = (row: string[], cols: Columns): ScrapedPriceEntry | null => {
  const apiId = cleanModelId(orEmpty(row[cols.model]))
  if (apiId === null) return null
  const inputPer1M = parsePrice(orEmpty(row[cols.input]))
  const outputPer1M = parsePrice(orEmpty(row[cols.output]))
  if (inputPer1M === null || outputPer1M === null) return null
  const cachedInputPer1M = parsePrice(orEmpty(row[cols.cachedInput]))
  return {
    apiId,
    inputPer1M,
    outputPer1M,
    cachedInputPer1M,
    contextWindow: null,
    legacy: false
  }
}

export class OpenAIProvider extends VendorProvider {
  readonly vendor = 'openai'
  protected readonly modelsEndpoint = 'https://api.openai.com/v1/models'
  protected readonly modelsAuth = 'bearer' as const

  async scrape(): Promise<ScrapedPriceEntry[]> {
    const html = await fetchScrapePage(PRICING_URL)
    if (html === null) return []
    const table = findStandardTable(html)
    if (table === null) {
      logger.warn('openai scrape: Standard-tier flagship table not found')
      return []
    }
    const cols = findColumns(table.headers)
    if (cols === null) {
      logger.warn({ headers: table.headers }, 'openai scrape: required columns missing')
      return []
    }
    const seen = new Set<string>()
    const out: ScrapedPriceEntry[] = []
    for (const row of table.rows) {
      const entry = readRow(row, cols)
      if (entry === null) continue
      if (seen.has(entry.apiId)) continue
      seen.add(entry.apiId)
      out.push(entry)
    }
    return out
  }
}
