/**
 * Prisma client singleton.
 *
 * The client is created lazily on first call so an unset DATABASE_URL
 * does not crash module load — callers that don't touch the DB (e.g.
 * the CLI workspace re-importing server utilities) stay unaffected.
 * Once instantiated, the same client is reused for the lifetime of the
 * process so the connection pool is not torn down per request.
 */

import { PrismaClient } from '@prisma/client'

let client: PrismaClient | null = null

export function getPrismaClient(): PrismaClient {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. The server reads Providers / Router from Postgres; ' +
          'start the postgres service via .devcontainer/compose.yaml and copy .env.example to .env.'
      )
    }
    client = new PrismaClient()
  }
  return client
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = null
  }
}

// Exposed only for tests that need to swap in a fresh client (e.g. after
// truncating tables between cases). Never call this in app code.
export function __resetPrismaClientForTests(): void {
  client = null
}
