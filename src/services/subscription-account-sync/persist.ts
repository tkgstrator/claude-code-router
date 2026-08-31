/**
 * DB write path: upsert a discovered account onto its matching
 * Provider(s), keep `activeSubscriptionAccountId` pointed at a usable
 * row, and the boot-time reconciliation self-heal.
 */

import { getPrismaClient } from '../../db/client'
import { AuthMode, type PrismaClient, type SubAccount } from '../../generated/prisma/client'
import { logger } from '../../logger'
import type { DiscoveredAccount } from '../../schemas/subscription.dto'
import { encryptionKey } from './crypto'
import {
  buildAccountPayload,
  buildClaudeDiscoveredAccount,
  buildCodexDiscoveredAccount,
  stableIdentityFor
} from './discovery'

const upsertAccount = async (
  prisma: PrismaClient,
  providerId: string,
  providerName: string,
  account: DiscoveredAccount,
  key: Buffer
): Promise<SubAccount> => {
  const existingRows = await prisma.subAccount.findMany({ where: { providerId } })
  const byIdentity = new Map(existingRows.map((a) => [stableIdentityFor(a), a]))
  const payload = buildAccountPayload(providerName, account, key)
  const existing = byIdentity.get(stableIdentityFor(account))
  if (existing) {
    return prisma.subAccount.update({
      where: { id: existing.id },
      data: { ...payload, sourcePath: account.sourcePath }
    })
  }
  return prisma.subAccount.create({
    data: { providerId, sourcePath: account.sourcePath, ...payload }
  })
}

// Set `activeSubscriptionAccountId` to the row we just upserted, unless
// the user has explicitly bound a (still-enabled) account already. The
// freshly-authed account is the most-recently-touched signal we have,
// and treating it as the new default mirrors what users expect after a
// successful Connect.
const ensureActiveAccount = async (prisma: PrismaClient, providerId: string, upsertedId: string): Promise<void> => {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    include: { activeSubscriptionAccount: true }
  })
  if (!provider) return
  const current = provider.activeSubscriptionAccount
  if (current && current.enabled) return
  await prisma.provider.update({
    where: { id: providerId },
    data: { activeSubscriptionAccountId: upsertedId }
  })
}

// Boot-time self-heal: pick up subscription providers whose active
// account is null (or points at a now-disabled row) and promote the
// oldest still-enabled account into the slot. Recovers DB state left
// over from the pre-fix toggle code path, which used to null the
// binding without choosing a successor.
export async function reconcileActiveSubAccounts(prisma: PrismaClient = getPrismaClient()): Promise<void> {
  const providers = await prisma.provider.findMany({
    where: { authMode: AuthMode.subscription },
    include: {
      activeSubscriptionAccount: true,
      subscriptionAccounts: { where: { enabled: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }
    }
  })
  for (const p of providers) {
    if (p.activeSubscriptionAccount?.enabled) continue
    const next = p.subscriptionAccounts[0]
    const nextId = next ? next.id : null
    // Already in the right shape: binding is null and there is no
    // candidate to promote — nothing to write.
    if (nextId === null && p.activeSubscriptionAccountId === null) continue
    await prisma.provider.update({
      where: { id: p.id },
      data: { activeSubscriptionAccountId: nextId }
    })
    if (nextId === null) {
      logger.info({ provider: p.name }, '[subaccount] reconcile: cleared stale active binding (no enabled candidate)')
    } else {
      logger.info(
        { provider: p.name, subAccountId: nextId },
        '[subaccount] reconcile: promoted enabled subaccount into orphaned active slot'
      )
    }
  }
}

export const providersForKind = async (
  prisma: PrismaClient,
  kind: 'claude' | 'codex'
): Promise<{ id: string; name: string }[]> => {
  const all = await prisma.provider.findMany({
    where: { authMode: AuthMode.subscription },
    select: { id: true, name: true, apiBaseUrl: true }
  })
  return all.filter((p) => {
    if (kind === 'claude') return p.apiBaseUrl.includes('anthropic.com')
    return p.apiBaseUrl.includes('chatgpt.com') || p.apiBaseUrl.includes('openai.com/v1')
  })
}

const recordOAuthAccount = async (
  kind: 'claude' | 'codex',
  account: DiscoveredAccount,
  prisma: PrismaClient
): Promise<void> => {
  const key = encryptionKey()
  const providers = await providersForKind(prisma, kind)
  if (providers.length === 0) {
    logger.warn({ kind }, '[subaccount] no subscription provider matched; skipping upsert')
    return
  }
  for (const p of providers) {
    const row = await upsertAccount(prisma, p.id, p.name, account, key)
    await ensureActiveAccount(prisma, p.id, row.id)
  }
}

export const recordClaudeOAuthAccount = async (
  tokens: {
    accessToken: string
    refreshToken: string
    expiresAt: number | null
    scopes: string[]
  },
  prisma: PrismaClient = getPrismaClient()
): Promise<void> => {
  const account = await buildClaudeDiscoveredAccount(tokens)
  if (!account) return
  await recordOAuthAccount('claude', account, prisma)
}

export const recordCodexOAuthAccount = async (
  tokens: {
    accessToken: string
    refreshToken: string
    // Optional: an ~/.codex/auth.json that carries `tokens.account_id`
    // identifies the account without one.
    idToken: string | null
    accountId?: string | null
  },
  prisma: PrismaClient = getPrismaClient()
): Promise<void> => {
  const account = buildCodexDiscoveredAccount(tokens)
  if (!account) return
  await recordOAuthAccount('codex', account, prisma)
}
