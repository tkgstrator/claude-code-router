import { runJsonToDbMigration } from '../db/migrateFromJson'
import { initConfig, initDir } from '../lib/configEnvelope'
import { ensureRouterSlots, ensureSeedProviders } from './configService'
import { seedScrapedPricesIntoDb } from './priceSeedService'

// One-shot bootstrap for hosts that don't go through the legacy
// Fastify Server class — the Hono root in src/index.ts calls this at
// module load so the DB is migrated/seeded the same way the old
// server did at boot.
export async function bootstrapServer(): Promise<void> {
  await initDir()
  await runJsonToDbMigration()
  await ensureSeedProviders()
  // ensureSeedProviders tops up openai/anthropic/google from the
  // third-party llm-prices snapshot (no prices). Reconcile those three
  // to the scraped official catalog right after so the DB's source of
  // truth is the vendor pricing pages, not llm-prices. Subscription
  // providers are untouched by this.
  await seedScrapedPricesIntoDb()
  await ensureRouterSlots()
  await initConfig()
}
