import { initConfig, initDir } from '../lib/configEnvelope'
import { logger, syncLevelFromEnv } from '../lib/logger'
import { ensureRouterSlots, ensureSeedProviders } from './configService'
import { seedScrapedPricesIntoDb } from './priceSeedService'
import { syncSubAccountsToDb } from './subscriptionAccountSyncService'
import { startUsageCapture } from './usageJob'

// One-shot bootstrap for hosts that don't go through the legacy
// Fastify Server class — the Hono root in src/index.ts calls this at
// module load so the DB is migrated/seeded the same way the old
// server did at boot.
export async function bootstrapServer(): Promise<void> {
  await initDir()
  await ensureSeedProviders()
  // ensureSeedProviders tops up openai/anthropic/google from the
  // third-party llm-prices snapshot (no prices). Reconcile those three
  // to the scraped official catalog right after so the DB's source of
  // truth is the vendor pricing pages, not llm-prices. Subscription
  // providers are untouched by this.
  await seedScrapedPricesIntoDb()
  await ensureRouterSlots()
  await initConfig()
  await syncSubAccountsToDb()
  // Re-apply LOG_LEVEL to the already-initialized logger. The pino
  // instance is created at import time before the config envelope has
  // been read, so the level must be updated once initConfig() has
  // mirrored config.json's LOG_LEVEL onto process.env.
  syncLevelFromEnv()
  logger.info({ APIKEY: process.env.APIKEY }, 'ccr APIKEY ready')
  // Fire-and-forget: never block server boot on Redis. The job setup
  // is resilient and registers the schedule once Redis is reachable.
  void startUsageCapture()
}
