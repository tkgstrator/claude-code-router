import { runJsonToDbMigration } from '../db/migrateFromJson'
import { initConfig, initDir } from '../utils/index'
import { ensureRouterSlots, ensureSeedProviders } from './configService'

// One-shot bootstrap for hosts that don't go through the legacy
// Fastify Server class — the Hono root in src/index.ts calls this at
// module load so the DB is migrated/seeded the same way the old
// server did at boot.
export async function bootstrapServer(): Promise<void> {
  await initDir()
  await runJsonToDbMigration()
  await ensureSeedProviders()
  await ensureRouterSlots()
  await initConfig()
}
