/**
 * Write-side application: diff an incoming UI payload against DB state
 * inside a single transaction, then persist the envelope to disk.
 */

import { ApplyConfigPayloadSchema, type Provider, type Router } from '@/schemas'
import { SCENARIO_KEYS } from '@/shared'
import { isDeprecatedModel } from '@/shared/data'
import { getPrismaClient } from '../../db/client'
import {
  AuthMode,
  type Model as DbModel,
  type Provider as DbProvider,
  ModelTestStatus,
  Prisma
} from '../../generated/prisma/client'
import { resetLlmsContext } from '../../llms'
import { modelApiStyleOverride } from './api-style'
import { writeConfigFile } from './envelope'
import { pruneUnsetEnvelopePaths } from './sync-to-disk'
import { disabledSet } from './transformer'

// Prisma 7 hangs the transaction-client type off the namespace export.
export type Tx = Prisma.TransactionClient

export type ApplyResult = {
  success: true
  warnings: string[]
}

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

export type SplitPayload = {
  envelope: Record<string, unknown>
  incomingProviders: Provider[]
  incomingRouter: Partial<Router>
}

// Parse the unvalidated UI payload at the boundary, then split into
// envelope / DB-bound parts. ApplyConfigPayloadSchema treats Providers
// and Router as optional, so the schema is happy with partial payloads
// (CRUD endpoints pass single-key shapes).
export const splitPayload = (payload: Record<string, unknown>): SplitPayload => {
  const parsed = ApplyConfigPayloadSchema.parse(payload)
  const { Providers, Router, ...envelope } = parsed
  return {
    envelope,
    incomingProviders: Providers !== undefined ? Providers : [],
    incomingRouter: Router !== undefined ? Router : {}
  }
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

// Sync incoming subscription_accounts toggles to DB. api_key providers
// ignore the field entirely; rows the UI doesn't own are skipped with a
// warning.
export async function applySubscriptionAccountToggles(
  tx: Tx,
  provider: DbProvider,
  incoming: Provider,
  warnings: string[]
): Promise<void> {
  if (provider.authMode !== AuthMode.subscription) return
  if (incoming.subscription_accounts === undefined) return
  const ownedRows = await tx.subAccount.findMany({
    where: { providerId: provider.id },
    select: { id: true, enabled: true }
  })
  const currentEnabled = new Map(ownedRows.map((a) => [a.id, a.enabled]))
  const toEnable: string[] = []
  const toDisable: string[] = []
  for (const entry of incoming.subscription_accounts) {
    const current = currentEnabled.get(entry.id)
    if (current === undefined) {
      warnings.push(
        `Subscription account "${entry.id}" does not belong to provider "${provider.name}"; toggle ignored.`
      )
      continue
    }
    if (current === entry.enabled) continue
    if (entry.enabled) toEnable.push(entry.id)
    else toDisable.push(entry.id)
  }
  if (toEnable.length > 0) {
    await tx.subAccount.updateMany({
      where: { id: { in: toEnable } },
      data: { enabled: true }
    })
  }
  if (toDisable.length > 0) {
    await tx.subAccount.updateMany({
      where: { id: { in: toDisable } },
      data: { enabled: false }
    })
    // If the active account just got disabled, drop the binding so
    // the next sync picks a fresh one from the still-enabled pool.
    const activeId = provider.activeSubscriptionAccountId
    if (activeId !== null && toDisable.includes(activeId)) {
      await tx.provider.update({
        where: { id: provider.id },
        data: { activeSubscriptionAccountId: null }
      })
    }
  }
}

// Reconcile the Model rows for a provider against the UI's `models` list:
// create the missing ones, delete the removed ones (clearing any
// RouterSlot still pointing at them first), and resync the deprecated
// flag on the rows we kept.
export async function reconcileModelRows(
  tx: Tx,
  provider: DbProvider & { models: DbModel[] },
  incoming: Provider,
  warnings: string[]
): Promise<void> {
  const desired = new Set(incoming.models)
  const existingNames = new Set(provider.models.map((m) => m.name))
  const toDelete = [...existingNames].filter((n) => !desired.has(n))
  const toCreate = [...desired].filter((n) => !existingNames.has(n))

  if (toDelete.length > 0) {
    const cleared = await tx.routerSlot.updateMany({
      where: { model: { providerId: provider.id, name: { in: toDelete } } },
      data: { modelId: null }
    })
    if (cleared.count > 0) {
      warnings.push(
        `Cleared ${cleared.count} router slot(s) for "${provider.name}" model(s) removed in this save: ${toDelete.join(', ')}.`
      )
    }
    await tx.model.deleteMany({
      where: { providerId: provider.id, name: { in: toDelete } }
    })
  }
  if (toCreate.length > 0) {
    await tx.model.createMany({
      // enabled omitted -> DB default (false). The authoritative
      // enabled state is written just below from the UI's selection.
      data: toCreate.map((name) => ({
        providerId: provider.id,
        name,
        deprecated: isDeprecatedModel(name),
        apiStyle: modelApiStyleOverride(name)
      }))
    })
  }

  // Resync the deprecation flag on rows we kept — the registry may
  // have flipped a model between releases, and we don't want a model
  // first seeded as active to silently stay that way.
  await syncDeprecationFlags(
    tx,
    provider.id,
    [...desired].filter((n) => existingNames.has(n))
  )
}

// Flip Model.enabled based on the UI's _disabledModels selection and
// reset persisted test status for any row whose enabled state actually
// changed (a re-enabled model shouldn't show a stale pass/fail; a
// disabled one shouldn't keep a result).
export async function applyModelEnabledFlips(
  tx: Tx,
  provider: DbProvider,
  incoming: Provider,
  prevEnabledByName: Map<string, boolean>
): Promise<void> {
  const nextDisabled = disabledSet(incoming.transformer)
  const desiredNames = [...new Set(incoming.models)]
  const toEnable = desiredNames.filter((n) => !nextDisabled.has(n))
  const toDisable = desiredNames.filter((n) => nextDisabled.has(n))
  const flipped = desiredNames.filter((n) => {
    const prev = prevEnabledByName.get(n)
    return prev !== undefined && prev !== !nextDisabled.has(n)
  })
  if (toEnable.length > 0) {
    await tx.model.updateMany({
      where: { providerId: provider.id, name: { in: toEnable }, enabled: false },
      data: { enabled: true }
    })
  }
  if (toDisable.length > 0) {
    await tx.model.updateMany({
      where: { providerId: provider.id, name: { in: toDisable }, enabled: true },
      data: { enabled: false }
    })
  }
  if (flipped.length > 0) {
    await tx.model.updateMany({
      where: { providerId: provider.id, name: { in: flipped } },
      data: {
        testStatus: ModelTestStatus.unknown,
        testCheckedAt: null,
        testPassedAt: null,
        testError: null
      }
    })
  }
}

// Delete providers the UI no longer lists, clearing any RouterSlot
// pointing at one of their models first (Restrict would otherwise
// abort the transaction).
export async function deleteRemovedProviders(
  tx: Tx,
  existing: ReadonlyArray<DbProvider & { models: DbModel[] }>,
  incomingByName: ReadonlyMap<string, Provider>,
  warnings: string[]
): Promise<void> {
  for (const ex of existing) {
    if (incomingByName.has(ex.name)) continue
    const cleared = await tx.routerSlot.updateMany({
      where: { model: { providerId: ex.id } },
      data: { modelId: null }
    })
    if (cleared.count > 0) {
      warnings.push(`Cleared ${cleared.count} router slot(s) bound to deleted provider "${ex.name}".`)
    }
    await tx.provider.delete({ where: { id: ex.id } })
  }
}

export async function applyProviders(tx: Tx, incoming: Provider[], warnings: string[]): Promise<void> {
  const existing = await tx.provider.findMany({ include: { models: true } })
  const incomingByName = new Map(incoming.map((p) => [p.name, p]))

  await deleteRemovedProviders(tx, existing, incomingByName, warnings)

  // Upsert what remains.
  for (const inc of incoming) {
    const authMode: AuthMode = inc.auth_mode === 'subscription' ? AuthMode.subscription : AuthMode.api_key
    const prevProvider = existing.find((e) => e.name === inc.name)
    const prevEnabledByName = new Map<string, boolean>(
      prevProvider ? prevProvider.models.map((m) => [m.name, m.enabled]) : []
    )
    const storedTransformer = buildStoredTransformer(inc)
    const apiKey = apiKeyForStorage(inc.api_key)
    const provider = await tx.provider.upsert({
      where: { name: inc.name },
      update: {
        apiBaseUrl: inc.api_base_url,
        apiKey,
        authMode,
        transformer: storedTransformer
      },
      create: {
        name: inc.name,
        apiBaseUrl: inc.api_base_url,
        apiKey,
        authMode,
        transformer: storedTransformer
      },
      include: { models: true }
    })

    // subscription_accounts only carries enable/disable flips — row
    // creation and deletion is owned by the sync service. We validate
    // ownership per id so a stale UI payload can't toggle some other
    // provider's account.
    await applySubscriptionAccountToggles(tx, provider, inc, warnings)

    await reconcileModelRows(tx, provider, inc, warnings)

    // Write the authoritative Model.enabled column from the UI's
    // _disabledModels selection (must run after reconcileModelRows so
    // the freshly-created rows exist).
    await applyModelEnabledFlips(tx, provider, inc, prevEnabledByName)
  }
}

export async function syncDeprecationFlags(tx: Tx, providerId: string, names: string[]): Promise<void> {
  if (names.length === 0) return
  const deprecated = names.filter(isDeprecatedModel)
  const active = names.filter((n) => !isDeprecatedModel(n))
  if (deprecated.length > 0) {
    await tx.model.updateMany({
      where: { providerId, name: { in: deprecated }, deprecated: false },
      data: { deprecated: true }
    })
  }
  if (active.length > 0) {
    await tx.model.updateMany({
      where: { providerId, name: { in: active }, deprecated: true },
      data: { deprecated: false }
    })
  }
}

// Validate a scenario's incoming fallback list against the DB: keep the
// entries that resolve to a known provider/model (preserving order),
// drop the rest with a warning. Mirrors the primary-slot validation so
// the stored chain only ever points at models that actually exist.
export async function resolveFallbackTargets(
  tx: Tx,
  scenario: string,
  raw: readonly string[] | undefined,
  warnings: string[]
): Promise<string[]> {
  if (raw === undefined || raw.length === 0) return []
  const out: string[] = []
  for (const entry of raw) {
    const { providerName, modelName } = parseSlot(entry)
    if (!providerName || !modelName) {
      warnings.push(`Router fallback for "${scenario}" is malformed ("${entry}"); dropped.`)
      continue
    }
    const model = await tx.model.findFirst({
      where: { name: modelName, provider: { name: providerName } }
    })
    if (!model) {
      warnings.push(
        `Router fallback "${providerName},${modelName}" for "${scenario}" references unknown model; dropped.`
      )
      continue
    }
    out.push(`${providerName},${modelName}`)
  }
  return out
}

export async function applyRouter(tx: Tx, incoming: Partial<Router>, warnings: string[]): Promise<void> {
  const longContextThreshold = typeof incoming.longContextThreshold === 'number' ? incoming.longContextThreshold : null

  for (const scenario of SCENARIO_KEYS) {
    const { providerName, modelName } = parseSlot(incoming[scenario])

    let modelId: string | null = null
    if (providerName && modelName) {
      const model = await tx.model.findFirst({
        where: { name: modelName, provider: { name: providerName } }
      })
      if (model) {
        modelId = model.id
      } else {
        warnings.push(`Router slot "${scenario}" references unknown model "${providerName},${modelName}"; left empty.`)
      }
    }

    const fallbacks = await resolveFallbackTargets(tx, scenario, incoming.fallbacks?.[scenario], warnings)

    // params holds the scenario-scoped knobs: longContext keeps its
    // threshold; any slot may carry a fallbacks chain. An empty object
    // collapses to DbNull so a slot with no knobs stores NULL.
    const paramsObj: Prisma.InputJsonObject = {
      ...(scenario === 'longContext' && longContextThreshold !== null ? { threshold: longContextThreshold } : {}),
      ...(fallbacks.length > 0 ? { fallbacks } : {})
    }
    const params: Prisma.InputJsonValue | typeof Prisma.DbNull =
      Object.keys(paramsObj).length > 0 ? paramsObj : Prisma.DbNull

    await tx.routerSlot.upsert({
      where: { scenario },
      update: { modelId, params },
      create: { scenario, modelId, params }
    })
  }

  // Surface any catchall (custom) keys we silently drop.
  const knownKeys = new Set<string>([...SCENARIO_KEYS, 'longContextThreshold', 'fallbacks'])
  const dropped = Object.keys(incoming).filter((k) => !knownKeys.has(k))
  if (dropped.length > 0) {
    warnings.push(`Router fields not yet stored in DB and were ignored: ${dropped.join(', ')}. (See PR #2.)`)
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
