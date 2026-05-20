#!/usr/bin/env bun
/**
 * Load the scraped official vendor prices into the Model table.
 *
 *   bun run scripts/seed-prices-db.ts
 *
 * Reconciles openai / anthropic / google (api_key) Models to the
 * scraped set with per-1M USD prices + deprecated/legacy flags.
 * Subscription providers are left untouched. Run after a
 * `bun run scrape:prices` to push fresh numbers into the DB.
 */

import 'dotenv/config'
import { seedScrapedPricesIntoDb } from '../src/services/price-seed-service'

const outcomes = await seedScrapedPricesIntoDb()
for (const o of outcomes) {
  if (o.skipped) {
    console.error(`${o.vendor}: skipped (${o.skipped})`)
  } else {
    console.error(`${o.vendor}: +${o.created} created, ~${o.updated} updated, -${o.deleted} deleted`)
  }
}
process.exit(0)
