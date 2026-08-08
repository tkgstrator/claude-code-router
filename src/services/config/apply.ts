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
import { syncLoggerFromEnv } from '../../logger'
import { applyProviders } from './apply/providers'
import { applyRouter } from './apply/router'
import { applyEnvelopeToEnv, writeConfigFile } from './envelope'
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
  // undefined = the key was absent from the payload, so the store is left
  // untouched. A partial save must never wipe what it didn't send — an
  // empty [] / {} would read as "delete everything".
  incomingProviders: Provider[] | undefined
  incomingRouter: Partial<Router> | undefined
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
  const envelope = Router !== undefined && 'persona' in Router ? { ...rest, ActivePersona: persona } : rest
  return {
    envelope,
    // Keep "absent" as undefined so applyUiConfig can skip the store
    // entirely instead of treating an omitted Providers / Router as a
    // request to delete everything it holds.
    incomingProviders: Providers,
    incomingRouter: Router !== undefined ? routerWithoutPersona : undefined
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
    // Skip a store the payload didn't include, so a partial save (e.g. a
    // Router-only write from the editor) leaves the omitted store intact
    // instead of wiping it — the bug this guards against cascaded from a
    // Provider delete all the way to OAuth accounts.
    if (incomingProviders !== undefined) await applyProviders(tx, incomingProviders, warnings)
    if (incomingRouter !== undefined) await applyRouter(tx, incomingRouter, warnings)
  })

  // Envelope changes happen on disk after the DB transaction commits;
  // we accept the small window where the two stores disagree because
  // failing the file write after a DB commit is no worse than failing
  // the DB write after a file write — and the file is the smaller of
  // the two surfaces.
  // Don't persist null / '' for the optional path scalars — drop the
  // key so "unset" stays absent on disk (composeUiConfig re-derives
  // null). A real value is written through unchanged.
  const envelopeToWrite = pruneUnsetEnvelopePaths(envelope)
  await writeConfigFile({
    ...envelopeToWrite,
    ...(incomingProviders !== undefined ? { Providers: incomingProviders } : {}),
    ...(incomingRouter !== undefined ? { Router: incomingRouter } : {})
  })

  // Keep process.env in sync with what we just wrote to disk. The
  // read-side env overlay in readConfigFile() reasserts process.env
  // over disk on every read, so a UI-changed scalar (LOG_LEVEL is the
  // usual culprit) would otherwise be silently clobbered on the next
  // GET by the value applyEnvelopeToEnv() mirrored at boot. Also
  // nudges the pino logger so a LOG_LEVEL change takes effect without
  // a restart. A partial save (e.g. Providers-only) sends an empty
  // envelope here; applyEnvelopeToEnv skips absent keys, so this is a
  // no-op in that case.
  applyEnvelopeToEnv(envelopeToWrite)
  syncLoggerFromEnv()

  // Force the llms context to rebuild on the next request so Router /
  // provider changes take effect immediately without a server restart.
  resetLlmsContext()

  return { success: true, warnings }
}
