/**
 * Shared helpers for DB-backed tests. Tests opt out cleanly when there
 * is no DATABASE_URL or when CI sets CCR_SKIP_DB_TESTS=1 — mirroring
 * the CCR_SKIP_LIVE_TESTS gate that the provider integration tests use.
 */

import { __resetPrismaClientForTests, getPrismaClient } from '../../packages/server/src/db/client'

export const HAS_DB = Boolean(process.env.DATABASE_URL) && process.env.CCR_SKIP_DB_TESTS !== '1'

/**
 * Wipe Provider / Model / RouterSlot so each test starts from a known
 * empty state. Cheaper than transactional rollback and works with
 * Prisma's connection model. Truncating with RESTART IDENTITY + CASCADE
 * also resets the FK chain and any sequences (we use cuids but this is
 * still the cleanest hammer).
 */
export async function resetDbTables(): Promise<void> {
  if (!HAS_DB) return
  const prisma = getPrismaClient()
  await prisma.$executeRawUnsafe('TRUNCATE "RouterSlot","Model","Provider" RESTART IDENTITY CASCADE')
}

export function teardownPrisma(): Promise<void> {
  __resetPrismaClientForTests()
  return Promise.resolve()
}
