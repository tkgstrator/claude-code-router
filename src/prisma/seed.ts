/**
 * Prisma seed entry — wired via package.json's `"prisma": { "seed": ... }`.
 * Runs automatically on `prisma migrate dev` / `migrate reset` / `db seed`,
 * and explicitly from entrypoint.sh after `prisma migrate deploy` in
 * production. All operations below are idempotent so re-runs are no-ops.
 */

import { logger } from '../logger'
import { ensureRouterSlots, ensureSeedProviders } from '../services/config/seed'
import { seedScrapedPricesIntoDb } from '../services/price-seed-service'

async function main(): Promise<void> {
  await ensureSeedProviders()
  // ensureSeedProviders tops up openai/anthropic/google from the
  // third-party llm-prices snapshot (no prices). Reconcile those three
  // to the scraped official catalog right after so the DB's source of
  // truth is the vendor pricing pages, not llm-prices. Subscription
  // providers are untouched by this.
  await seedScrapedPricesIntoDb()
  await ensureRouterSlots()
  logger.info('prisma seed complete')
}

await main()
