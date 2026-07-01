/**
 * DeepSeek vendor provider. Scrapes the pricing table at
 * api-docs.deepseek.com/quick_start/pricing.
 *
 * The page ships a single, transposed table: models are COLUMNS
 * (row 0 is the header — cells 1..N are model ids) and rows describe
 * per-model features (BASE URL, CONTEXT LENGTH, PRICING sub-rows...).
 * We locate the pricing rows by label and pull each model column's cell.
 *
 * DeepSeek's "cache hit" column is the equivalent of anthropic /
 * openai's "cached input" rate, so we map it to cachedInputPer1M;
 * "cache miss" is the standard input rate.
 *
 * Context length is listed once (row 5 spans all model columns) as a
 * single number like "1M"; we parse it and apply to every discovered
 * model id.
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

const PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing'

// Row 0 cells look like "deepseek-v4-flash(1)" — the "(1)" is a
// footnote marker; strip it plus any surrounding whitespace.
const cleanModelId = (raw: string): string | null => {
  const s = raw.trim()
  if (s === '' || /^model$/i.test(s)) return null
  const m = s.match(/^([a-z0-9][a-z0-9.\-_]*)/i)
  return m === null ? null : m[1]
}

// The pricing rows land in different shapes: the "PRICING" header row
// stuffs the price label into cell 1 and the values start at cell 2;
// subsequent rows drop the header cell entirely and the label is at
// cell 0. This helper normalises both to { label, values[] }.
interface LabelledRow {
  label: string
  values: string[]
}

const orEmpty = (v: string | undefined): string => (v === undefined ? '' : v)

const asLabelled = (row: string[]): LabelledRow => {
  if (/pricing/i.test(orEmpty(row[0]))) {
    return { label: orEmpty(row[1]), values: row.slice(2) }
  }
  return { label: orEmpty(row[0]), values: row.slice(1) }
}

const findModelHeader = (rows: string[][]): string[] | null => {
  const header = rows[0]
  if (header === undefined || header.length < 2) return null
  if (!/^model$/i.test(orEmpty(header[0]))) return null
  return header.slice(1).map((c) => c.trim())
}

const findContextWindow = (rows: string[][]): number | null => {
  const ctxRow = rows.find((r) => /^context\s*length/i.test(orEmpty(r[0])))
  if (ctxRow === undefined) return null
  return parseContext(orEmpty(ctxRow[1]))
}

const findPriceValues = (rows: string[][], labelPattern: RegExp): string[] | null => {
  for (const row of rows) {
    const { label, values } = asLabelled(row)
    if (labelPattern.test(label)) return values
  }
  return null
}

export class DeepSeekProvider extends VendorProvider {
  readonly vendor = 'deepseek'
  protected readonly modelsEndpoint = 'https://api.deepseek.com/v1/models'
  protected readonly modelsAuth = 'bearer' as const

  async scrape(): Promise<ScrapedPriceEntry[]> {
    const html = await fetchScrapePage(PRICING_URL)
    if (html === null) return []
    const tables = findTables(html)
    if (tables.length === 0) {
      logger.warn('deepseek scrape: no tables on pricing page')
      return []
    }
    const rows = splitRows(tables[0]).map(splitCells)
    const modelIds = findModelHeader(rows)
    if (modelIds === null) {
      logger.warn('deepseek scrape: transposed model header not recognised')
      return []
    }
    const inputMissValues = findPriceValues(rows, /cache\s*miss/i)
    const cacheHitValues = findPriceValues(rows, /cache\s*hit/i)
    const outputValues = findPriceValues(rows, /output\s*tokens?/i)
    if (inputMissValues === null || outputValues === null) {
      logger.warn('deepseek scrape: input (cache miss) or output row missing')
      return []
    }
    const contextWindow = findContextWindow(rows)
    return modelIds
      .map((raw, i) =>
        buildScrapedEntry(cleanModelId(raw), inputMissValues[i], outputValues[i], cacheHitValues, i, contextWindow)
      )
      .filter((e): e is ScrapedPriceEntry => e !== null)
  }
}

const buildScrapedEntry = (
  apiId: string | null,
  inputCell: string | undefined,
  outputCell: string | undefined,
  cacheHitValues: string[] | null,
  columnIndex: number,
  contextWindow: number | null
): ScrapedPriceEntry | null => {
  if (apiId === null) return null
  const inputPer1M = parsePrice(orEmpty(inputCell))
  const outputPer1M = parsePrice(orEmpty(outputCell))
  if (inputPer1M === null || outputPer1M === null) return null
  const cachedInputPer1M = cacheHitValues === null ? null : parsePrice(orEmpty(cacheHitValues[columnIndex]))
  return { apiId, inputPer1M, outputPer1M, cachedInputPer1M, contextWindow, legacy: false }
}
