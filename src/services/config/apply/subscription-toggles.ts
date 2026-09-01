/**
 * Sync incoming subscription_accounts enable/disable toggles onto the
 * SubAccount rows a Provider owns.
 */

import type { Provider } from '@/schemas/domain/provider'
import { AuthMode, type Provider as DbProvider } from '../../../generated/prisma/client'
import type { Tx } from '../apply'

// api_key providers ignore the field entirely; rows the UI doesn't own
// are skipped with a warning.
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
    // If the active account just got disabled, promote any other
    // still-enabled account so the provider keeps serving requests.
    // Only fall back to null when no enabled candidate remains —
    // otherwise the Models view and proxy treat the provider as
    // unavailable until the next OAuth Connect.
    const activeId = provider.activeSubscriptionAccountId
    if (activeId !== null && toDisable.includes(activeId)) {
      const replacement = await tx.subAccount.findFirst({
        where: { providerId: provider.id, enabled: true, id: { notIn: toDisable } },
        orderBy: { createdAt: 'asc' },
        select: { id: true }
      })
      await tx.provider.update({
        where: { id: provider.id },
        data: { activeSubscriptionAccountId: replacement ? replacement.id : null }
      })
    }
  }
}
