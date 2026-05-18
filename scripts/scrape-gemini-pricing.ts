#!/usr/bin/env bun
/**
 * Scrape https://ai.google.dev/gemini-api/docs/pricing and emit
 * packages/shared/src/data/providers/google/prices.json.
 *
 *   bun run scripts/scrape-gemini-pricing.ts          # write the JSON
 *   bun run scripts/scrape-gemini-pricing.ts --dry    # print + count only
 *
 * Page layout:
 *   - Each model lives under an <h2 id="gemini-..."> — the id
 *     attribute is the canonical model id we keep.
 *   - The H2 is followed by H3s ("Standard", "Batch API", "Cached",
 *     "Audio", …) and per-tier <table>s. Each table has a 3-column
 *     shape: (pricing dimension | free tier | paid tier).
 *   - Price cells embed modality variants ("$0.25 (text / image /
 *     video)$0.50 (audio)"); we keep the first $-number as the text
 *     rate. Audio surcharges and >200k context tiers are dropped.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const SOURCE_URL = 'https://ai.google.dev/gemini-api/docs/pricing'
const OUT = join(import.meta.dir, '../packages/shared/src/data/providers/google/prices.json')

interface RawRow {
  dimension: string
  paid: string | null
}
interface RawTable {
  tier: string | null
  rows: RawRow[]
}
interface RawModel {
  id: string
  heading: string
  tables: RawTable[]
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
  })
  await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForSelector('h2', { timeout: 30_000 })

  const models = await page.evaluate((): RawModel[] => {
    const root = document.querySelector('main') ?? document.body
    const all = Array.from(root.querySelectorAll<HTMLElement>('h2, h3, table'))
    const out: RawModel[] = []
    const text = (cell: Element): string => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()

    let current: RawModel | null = null
    let currentTier: string | null = null

    for (const node of all) {
      if (node.tagName === 'H2') {
        const id = node.id || ''
        // Only price the gemini family — imagen / veo / lyria are
        // either non-token billed or out of scope for now.
        if (!id || !/^gemini[-\d]/.test(id)) {
          current = null
          currentTier = null
          continue
        }
        current = { id, heading: text(node), tables: [] }
        out.push(current)
        currentTier = null
        continue
      }
      if (!current) continue
      if (node.tagName === 'H3') {
        currentTier = text(node)
        continue
      }
      if (node.tagName === 'TABLE') {
        const rows: RawRow[] = []
        for (const tr of node.querySelectorAll('tbody tr, tr')) {
          const cells = Array.from(tr.querySelectorAll('td')).map(text)
          if (cells.length === 0) continue
          rows.push({
            dimension: cells[0] ?? '',
            paid: cells.length >= 3 ? (cells[2] ?? null) : (cells[1] ?? null)
          })
        }
        if (rows.length > 0) current.tables.push({ tier: currentTier, rows })
      }
    }
    return out
  })

  // --- Flatten to { id: { input, output } } ------------------------------

  const parsePrice = (raw: string | null): number | null => {
    if (!raw) return null
    const trimmed = raw.trim()
    if (!trimmed || /^free/i.test(trimmed) || /not available/i.test(trimmed) || trimmed === '-') return null
    // First $-prefixed number is the text-modality / short-context rate.
    const m = trimmed.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/)
    return m ? Number(m[1]) : null
  }

  const isStandardTier = (tier: string | null): boolean => {
    if (!tier) return true
    return /^standard\b/i.test(tier) || /standard\s*tier/i.test(tier)
  }

  const prices: Record<string, { input: number; output: number; context?: number }> = {}
  for (const m of models) {
    // Prefer a tier explicitly labelled "Standard"; many sections only
    // expose a single table which we treat as Standard.
    const candidate = m.tables.find((t) => isStandardTier(t.tier)) ?? m.tables[0]
    if (!candidate) continue
    const inputRow = candidate.rows.find((r) => /input price/i.test(r.dimension))
    const outputRow = candidate.rows.find((r) => /output price/i.test(r.dimension))
    const input = parsePrice(inputRow?.paid ?? null)
    const output = parsePrice(outputRow?.paid ?? null)
    if (input == null || output == null) continue
    prices[m.id] = { input, output }
  }

  if (Object.keys(prices).length === 0) {
    console.error('No prices parsed — page layout likely changed. Aborting without overwrite.')
    process.exit(1)
  }

  // Context window: absent from the pricing page. The Gemini 3 docs
  // page has a "Model ID | Context Window (In / Out) | …" table; its
  // Model IDs are the same dotted ids the pricing page uses, so match
  // directly. Only the Gemini 3 series is listed there — older ids stay
  // unset (context is optional). Best-effort: never abort on failure.
  const GEMINI3_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/gemini-3'
  const parseCtx = (raw: string): number | null => {
    const inPart = (raw.split('/')[0] ?? '').replace(/,/g, '').trim()
    const mm = inPart.match(/([0-9]+(?:\.[0-9]+)?)\s*([kKmM])?/)
    if (!mm) return null
    const n = Number(mm[1])
    const u = (mm[2] ?? '').toLowerCase()
    return Math.round(u === 'm' ? n * 1e6 : u === 'k' ? n * 1e3 : n)
  }
  try {
    await page.goto(GEMINI3_DOCS_URL, { waitUntil: 'networkidle', timeout: 60_000 })
    const idCtx: Record<string, string> = await page.evaluate(() => {
      const res: Record<string, string> = {}
      for (const t of Array.from(document.querySelectorAll('table'))) {
        const hdr = Array.from(
          t.querySelectorAll('thead th, tr:first-child th, tr:first-child td')
        ).map((x) => (x.textContent ?? '').trim().toLowerCase())
        const idIdx = hdr.findIndex((h) => h.includes('model id'))
        const ctxIdx = hdr.findIndex((h) => h.includes('context window'))
        if (idIdx < 0 || ctxIdx < 0) continue
        for (const tr of Array.from(t.querySelectorAll('tbody tr'))) {
          const c = Array.from(tr.querySelectorAll('th,td')).map((x) =>
            (x.textContent ?? '').replace(/\s+/g, ' ').trim()
          )
          if (c[idIdx] && c[ctxIdx]) res[c[idIdx]] = c[ctxIdx]
        }
      }
      return res
    })
    for (const [id, raw] of Object.entries(idCtx)) {
      const c = parseCtx(raw)
      if (c != null && prices[id]) prices[id].context = c
    }
  } catch {
    // Docs page changed / unreachable — leave context unset.
  }

  const sorted: Record<string, { input: number; output: number; context?: number }> = {}
  for (const id of Object.keys(prices).sort()) sorted[id] = prices[id]

  const payload = {
    vendor: 'google',
    source: SOURCE_URL,
    lastChecked: new Date().toISOString().slice(0, 10),
    notes: [
      'USD per 1M tokens, Paid tier, text modality.',
      'Price cells embed modality variants ("$X (text / image / video)$Y (audio)"); we keep the first $-number which is the text rate.',
      'Audio surcharges and >200k context surcharges are dropped — we keep a single (input, output) pair.',
      'Imagen / Veo / Lyria / Gemma model families are skipped (non-token or out of scope).',
      'context is the input side of the "Context Window (In / Out)" table on https://ai.google.dev/gemini-api/docs/gemini-3 (Gemini 3 series only; older ids stay unset).',
      'Generated by scripts/scrape-gemini-pricing.ts.'
    ],
    prices: sorted
  }

  const dry = process.argv.includes('--dry')
  const serialized = `${JSON.stringify(payload, null, 2)}\n`
  if (dry) {
    console.log(serialized)
    console.error(`(dry-run) parsed ${Object.keys(sorted).length} model ids`)
  } else {
    writeFileSync(OUT, serialized)
    console.error(`Wrote ${Object.keys(sorted).length} model ids → ${OUT}`)
  }
} finally {
  await browser.close()
}
