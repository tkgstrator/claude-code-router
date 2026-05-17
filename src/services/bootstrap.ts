import { randomBytes } from 'node:crypto'
import { runJsonToDbMigration } from '../db/migrateFromJson'
import { initConfig, initDir, readConfigFile, writeConfigFile } from '../lib/configEnvelope'
import { ensureRouterSlots, ensureSeedProviders } from './configService'
import { seedScrapedPricesIntoDb } from './priceSeedService'
import { pruneOldSnapshots, recordUsageSnapshots } from './usageHistoryService'

const SNAPSHOT_INTERVAL_MS = 5 * 60_000

// Module-load can re-run under the Vite SSR runner; keep a single
// loop. A self-rescheduling setTimeout (not setInterval) so the next
// capture is only queued AFTER the current one settles — no overlap
// or drift if a usage fetch is slow, and a failure never stops the
// loop or crashes the server.
const capture: { started: boolean } = { started: false }

async function captureOnce(): Promise<void> {
  try {
    await recordUsageSnapshots()
    await pruneOldSnapshots()
  } catch {
    // swallow — the loop must keep going
  }
}

function startUsageCapture(): void {
  if (capture.started) return
  capture.started = true
  const tick = async (): Promise<void> => {
    await captureOnce()
    setTimeout(tick, SNAPSHOT_INTERVAL_MS)
  }
  setTimeout(tick, 10_000) // let boot settle before the first hit
}

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
  startUsageCapture()
}
