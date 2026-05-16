/**
 * Scrape https://ai.google.dev/gemini-api/docs/pricing and emit a JSON
 * dump of every model section + pricing table. Used to refresh the
 * google entries in packages/shared/src/data/llm-prices.json without
 * waiting for the upstream llm-prices.com snapshot to catch up.
 *
 * Usage:
 *   bun scripts/scrape-gemini-pricing.ts             # pretty-print
 *   bun scripts/scrape-gemini-pricing.ts > out.json  # capture
 *
 * Page structure (observed):
 *   - Each model lives under an <h2 id="gemini-..."> — the id attribute
 *     is the model identifier we keep.
 *   - The H2 is followed by H3s (Standard / Batch / Flex / Priority)
 *     and per-tier <table>s. Each table has a 3-column shape:
 *       (pricing dimension | free tier | paid tier).
 *   - Some tables only have a paid column; we keep the shape and emit
 *     null for missing values.
 */

import { chromium } from 'playwright'

const TARGET_URL = 'https://ai.google.dev/gemini-api/docs/pricing'

interface PricingRow {
  dimension: string
  freeTier: string | null
  paidTier: string | null
}

interface PricingTable {
  tier: string | null
  rows: PricingRow[]
}

interface ModelEntry {
  id: string
  heading: string
  tables: PricingTable[]
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    })
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.waitForSelector('h2', { timeout: 30_000 })

    const models = await page.evaluate(() => {
      const root = document.querySelector('main') ?? document.body
      const all = Array.from(root.querySelectorAll<HTMLElement>('h2, h3, table'))
      const out: ModelEntry[] = []
      const cleanCell = (cell: Element): string => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()

      let current: ModelEntry | null = null
      let currentTier: string | null = null

      for (const node of all) {
        if (node.tagName === 'H2') {
          const id = node.id || ''
          if (!id || !/^(gemini|gemma|imagen|veo|lyria)[-\d]/.test(id)) {
            current = null
            currentTier = null
            continue
          }
          current = { id, heading: cleanCell(node), tables: [] }
          out.push(current)
          currentTier = null
          continue
        }
        if (!current) continue
        if (node.tagName === 'H3') {
          currentTier = cleanCell(node)
          continue
        }
        if (node.tagName === 'TABLE') {
          const rows: PricingRow[] = []
          for (const tr of node.querySelectorAll('tbody tr, tr')) {
            const cells = Array.from(tr.querySelectorAll('td')).map(cleanCell)
            if (cells.length === 0) continue
            rows.push({
              dimension: cells[0] ?? '',
              freeTier: cells.length >= 3 ? (cells[1] ?? null) : null,
              paidTier: cells.length >= 3 ? (cells[2] ?? null) : (cells[1] ?? null)
            })
          }
          if (rows.length > 0) {
            current.tables.push({ tier: currentTier, rows })
          }
        }
      }
      return out
    })

    process.stdout.write(`${JSON.stringify({ url: TARGET_URL, scrapedAt: new Date().toISOString(), models }, null, 2)}\n`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('Scrape failed:', err)
  process.exit(1)
})
