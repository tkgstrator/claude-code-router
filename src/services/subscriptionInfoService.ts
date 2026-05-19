import { getPrismaClient } from '../db/client'
import type { PrismaClient } from '../generated/prisma/client'

export interface SubscriptionAccountInfo {
  id: string
  label: string
  sourcePath: string
  enabled: boolean
  userName: string | null
  userEmail: string | null
  userId: string | null
  plan: string | null
  rateLimitTier: string | null
  expiresAt: number | null
  scopes: string[] | null
}

export interface SubscriptionInfo {
  providerName: string
  enabled: boolean
  accounts: SubscriptionAccountInfo[]
  activeAccount: SubscriptionAccountInfo | null
}

const providerEnabled = (enabled: unknown, transformer: unknown): boolean =>
  enabled !== false && (transformer as { providerEnabled?: unknown } | null | undefined)?.providerEnabled !== false

const toAccountInfo = (a: {
  id: string
  label: string
  sourcePath: string
  enabled: boolean
  userName: string | null
  userEmail: string | null
  userId: string | null
  plan: string | null
  rateLimitTier: string | null
  expiresAt: Date | null
  scopes: unknown
}): SubscriptionAccountInfo => ({
  id: a.id,
  label: a.label,
  sourcePath: a.sourcePath,
  enabled: a.enabled,
  userName: a.userName,
  userEmail: a.userEmail,
  userId: a.userId,
  plan: a.plan,
  rateLimitTier: a.rateLimitTier,
  expiresAt: a.expiresAt ? a.expiresAt.valueOf() : null,
  scopes: Array.isArray(a.scopes) ? a.scopes.filter((s): s is string => typeof s === 'string') : null
})

export async function getSubscriptionsInfo(prisma: PrismaClient = getPrismaClient()): Promise<SubscriptionInfo[]> {
  const providers = await prisma.provider.findMany({
    where: { authMode: 'subscription' },
    include: {
      subscriptionAccounts: { orderBy: { createdAt: 'asc' } },
      activeSubscriptionAccount: true
    },
    orderBy: { createdAt: 'asc' }
  })
  return providers.map((p) => {
    const accounts = p.subscriptionAccounts.map(toAccountInfo)
    const active = p.activeSubscriptionAccount ? toAccountInfo(p.activeSubscriptionAccount) : null
    return {
      providerName: p.name,
      enabled: providerEnabled(true, p.transformer),
      accounts,
      activeAccount: active
    }
  })
}
