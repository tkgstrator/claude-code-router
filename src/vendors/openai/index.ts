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

// Per-model docs page URL the "N,NNN,NNN context window" figure lives on.
const MODEL_DOCS_URL = (id: string): string => `https://developers.openai.com/api/docs/models/${id}`

// Bounded concurrency for per-model fetches — 6 in flight at once keeps
// a full-catalog refresh (~60 ids) well under a minute without hammering
// developers.openai.com. Simple worker-pool: N workers pop from a shared
// mutable list until it's empty.
const CONTEXT_FETCH_CONCURRENCY = 6

// React SSR emits an HTML comment between adjacent text nodes so
// hydration can align them — the model docs page ships e.g.
// `<div>1,050,000<!-- --> context window</div>`, which puts a comment
// between the number and the label. Strip HTML comments before matching
// so the plain-text regex catches the pattern regardless.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const CONTEXT_RE = /([0-9][0-9,]*)\s*context window/i

const parseContextFromHtml = (html: string): number | null => {
  const m = html.replace(HTML_COMMENT_RE, ' ').match(CONTEXT_RE)
  if (m === null) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
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

  // The pricing page returns no contextWindow — this walks the per-model
  // docs pages instead. Each page publishes "N,NNN,NNN context window"
  // near the header; we grep for that pattern. Called from
  // refreshOneProvider so every DB row (including Codex subscription
  // ids like `gpt-5.6-*` that never appear on the pricing table) gets
  // its context refreshed against the vendor's own docs.
  async fetchContextWindows(ids: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    const queue = [...ids]
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const id = queue.shift()
        if (id === undefined) return
        const html = await fetchScrapePage(MODEL_DOCS_URL(id))
        if (html === null) continue
        const n = parseContextFromHtml(html)
        if (n !== null) out.set(id, n)
      }
    }
    const workerCount = Math.min(CONTEXT_FETCH_CONCURRENCY, queue.length)
    await Promise.all(Array.from({ length: workerCount }, worker))
    return out
  }
}
