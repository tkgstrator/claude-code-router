/**
 * Write-side application: diff an incoming UI payload against DB state
 * inside a single transaction, then persist the envelope to disk.
 *
 * Provider / Router diffing logic lives in ./apply/*; this file owns
 * the payload split, the transaction orchestration, and re-exports the
 * stable public surface (applyProviders / syncDeprecationFlags are also
 * consumed directly by sibling config modules).
 */

import { ApplyConfigPayloadSchema, type Provider, type Router } from '@/schemas'
import { getPrismaClient } from '../../db/client'
import type { Prisma } from '../../generated/prisma/client'
import { resetLlmsContext } from '../../llms'
import { applyProviders } from './apply/providers'
import { applyRouter } from './apply/router'
import { writeConfigFile } from './envelope'
import { pruneUnsetEnvelopePaths } from './sync-to-disk'

export { apiKeyForStorage, buildStoredTransformer, parseSlot } from './apply/fields'
export { syncDeprecationFlags } from './apply/model-rows'
export { applyProviders } from './apply/providers'

// Prisma 7 hangs the transaction-client type off the namespace export.
export type Tx = Prisma.TransactionClient

export type ApplyResult = {
  success: true
  warnings: string[]
}

export type SplitPayload = {
  envelope: Record<string, unknown>
  incomingProviders: Provider[]
  incomingRouter: Partial<Router>
}

// Parse the unvalidated UI payload at the boundary, then split into
// envelope / DB-bound parts. ApplyConfigPayloadSchema treats Providers
// and Router as optional, so the schema is happy with partial payloads
// (CRUD endpoints pass single-key shapes).
//
// The active persona arrives nested on Router.persona but is stored in
// the disk envelope (no DB column), so we lift it out of the router slice
// onto the envelope's ActivePersona backing key when present. An empty
// string / null clears it (pruneUnsetEnvelopePaths drops it off disk);
// an absent key leaves the envelope untouched so a router-only save that
// omits persona doesn't wipe the current selection.
export const splitPayload = (payload: Record<string, unknown>): SplitPayload => {
  const parsed = ApplyConfigPayloadSchema.parse(payload)
  const { Providers, Router, ...rest } = parsed
  const { persona, ...routerWithoutPersona } = Router !== undefined ? Router : {}
  const envelope = 'persona' in (Router !== undefined ? Router : {}) ? { ...rest, ActivePersona: persona } : rest
  return {
    envelope,
    incomingProviders: Providers !== undefined ? Providers : [],
    incomingRouter: routerWithoutPersona
  }
}

export async function applyUiConfig(payload: Record<string, unknown>): Promise<ApplyResult> {
  const { envelope, incomingProviders, incomingRouter } = splitPayload(payload)
  const warnings: string[] = []

  const prisma = getPrismaClient()

  // The whole DB mutation is one interactive transaction so we never leave
  // a Provider deleted with a RouterSlot still pointing at one of its
  // models (which Restrict would block mid-way otherwise).
  await prisma.$transaction(async (tx) => {
    await applyProviders(tx, incomingProviders, warnings)
    await applyRouter(tx, incomingRouter, warnings)
  })

  // Envelope changes happen on disk after the DB transaction commits;
  // we accept the small window where the two stores disagree because
  // failing the file write after a DB commit is no worse than failing
  // the DB write after a file write — and the file is the smaller of
  // the two surfaces.
  // Don't persist null / '' for the optional path scalars — drop the
  // key so "unset" stays absent on disk (composeUiConfig re-derives
  // null). A real value is written through unchanged.
  await writeConfigFile({
    ...pruneUnsetEnvelopePaths(envelope),
    Providers: incomingProviders,
    Router: incomingRouter
  })

  // Force the llms context to rebuild on the next request so Router /
  // provider changes take effect immediately without a server restart.
  resetLlmsContext()

  return { success: true, warnings }
}
