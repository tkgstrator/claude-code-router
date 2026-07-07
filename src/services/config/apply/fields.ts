/**
 * Pure field-normalization helpers used while diffing an incoming UI
 * payload against DB state. No Prisma transaction dependency, so these
 * stay free of the `Tx` type and avoid a circular import with apply.ts.
 */

import type { Provider } from '@/schemas'
import { Prisma } from '../../../generated/prisma/client'

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

// Build the JSONB blob persisted on Provider.transformer. The wire
// shape carries two derived keys we do not store: `_disabledModels`
// (the inverse of Model.enabled, re-derived in toProvider) and
// `providerEnabled` (rewritten here from the top-level `enabled`
// flag). Both are dropped before persistence so the DB never holds a
// stale copy.
export const buildStoredTransformer = (incoming: Provider): Prisma.InputJsonObject | typeof Prisma.DbNull => {
  const transformer = incoming.transformer
  const rest: Prisma.InputJsonObject = (() => {
    if (!transformer) return {}
    const { _disabledModels: _d, providerEnabled: _p, ...keep } = transformer
    return keep
  })()
  const base: Prisma.InputJsonObject = {
    ...rest,
    // Provider-level enable/disable persisted in transformer JSON until
    // Provider.enabled is promoted to a dedicated DB column.
    ...(incoming.enabled === false ? { providerEnabled: false } : {})
  }
  if (Object.keys(base).length === 0) return Prisma.DbNull
  return base
}
