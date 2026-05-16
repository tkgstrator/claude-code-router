/**
 * Prisma client singleton (Prisma 7, driver-adapter style).
 *
 * Lazy: an unset DATABASE_URL only blows up when something actually
 * touches the DB. Once instantiated, the same client is reused for the
 * process lifetime so the pg pool isn't torn down per request.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

let client: PrismaClient | null = null

export function getPrismaClient(): PrismaClient {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. The server reads Providers / Router from Postgres; ' +
          'start the postgres service via .devcontainer/compose.yaml and copy .env.example to .env.'
      )
    }
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
    client = new PrismaClient({ adapter })
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
