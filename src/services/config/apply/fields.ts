/**
 * Pure field-normalization helpers used while diffing an incoming UI
 * payload against DB state. No Prisma transaction dependency, so these
 * stay free of the `Tx` type and avoid a circular import with apply.ts.
 */

import type { Provider } from '@/schemas/domain/provider'

// Normalize an incoming api_key for storage. "Unset" is always NULL in
// the DB — an empty / whitespace-only value from the wire is collapsed
// to null so '' can never creep back. A real null stays null (never
// coerced to ''); a present value is stored verbatim.
export const apiKeyForStorage = (raw: string | null): string | null => {
  if (raw === null) return null
  return raw.trim().length === 0 ? null : raw
}

// Pull a "providerName,modelName" string apart. Empty / malformed input
// resolves to null,null — the slot will be nulled out.
export const parseSlot = (raw: unknown): { providerName: string | null; modelName: string | null } => {
  if (typeof raw !== 'string' || raw.length === 0) return { providerName: null, modelName: null }
  const [p, m] = raw.split(',')
  if (!p || !m) return { providerName: null, modelName: null }
  return { providerName: p.trim(), modelName: m.trim() }
}
