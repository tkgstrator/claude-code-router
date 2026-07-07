/**
 * Diff the incoming UI Provider list against DB state: delete removed
 * providers, upsert what remains, and cascade the SubAccount toggle /
 * Model row / enabled-flip reconciliation for each.
 */

import type { Provider } from '@/schemas'
import { AuthMode, type Model as DbModel, type Provider as DbProvider } from '../../../generated/prisma/client'
import type { Tx } from '../apply'
import { apiKeyForStorage, buildStoredTransformer } from './fields'
import { applyModelEnabledFlips, reconcileModelRows } from './model-rows'
import { applySubscriptionAccountToggles } from './subscription-toggles'

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
