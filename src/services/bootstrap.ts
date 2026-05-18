import { randomBytes } from 'node:crypto'
import { runJsonToDbMigration } from '../db/migrateFromJson'
import { initConfig, initDir, readConfigFile, writeConfigFile } from '../lib/configEnvelope'
import { syncLevelFromEnv } from '../lib/logger'
import { ensureRouterSlots, ensureSeedProviders } from './configService'
import { seedScrapedPricesIntoDb } from './priceSeedService'
import { startUsageCapture } from './usageJob'

// First boot must never come up as an open proxy to the user's paid
// subscriptions. If no APIKEY is set, mint a 128-bit hex secret,
// persist it to the envelope, and surface it so the operator can paste
// it into the client (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN). Once
// set it's left alone (rotate from the UI).
async function ensureApiKey(): Promise<void> {
  const cfg = (await readConfigFile()) as Record<string, unknown>
  const current = typeof cfg.APIKEY === 'string' ? cfg.APIKEY.trim() : ''
  if (current.length > 0) return
  const key = randomBytes(16).toString('hex')
  await writeConfigFile({ ...cfg, APIKEY: key })
  console.warn(
    [
      '',
      '[ccr] No APIKEY was configured — generated one so /api and /v1',
      '[ccr] are not exposed unauthenticated:',
      `[ccr]   APIKEY=${key}`,
      `[ccr] Point the client at it, e.g. ANTHROPIC_API_KEY=${key}`,
      ''
    ].join('\n')
  )
}

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
  await ensureApiKey()
  await initConfig()
  // Re-apply LOG_LEVEL to the already-initialized logger. The pino
  // instance is created at import time before the config envelope has
  // been read, so the level must be updated once initConfig() has
  // mirrored config.json's LOG_LEVEL onto process.env.
  syncLevelFromEnv()
  // Fire-and-forget: never block server boot on Redis. The job setup
  // is resilient and registers the schedule once Redis is reachable.
  void startUsageCapture()
}
