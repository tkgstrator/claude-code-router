import type { z } from '@hono/zod-openapi'
import { getPrismaClient } from '../db/client'
import type { PrismaClient } from '../generated/prisma/client'
import type { SubscriptionInfoSchema, SubscriptionProviderInfoSchema } from '../schemas/subscription.dto'
import { isJsonObject } from './config/transformer'

export type SubscriptionAccountInfo = z.infer<typeof SubscriptionInfoSchema>
export type SubscriptionInfo = z.infer<typeof SubscriptionProviderInfoSchema>

const isProviderEnabled = (transformer: unknown): boolean => {
  if (!isJsonObject(transformer)) return true
  return transformer.providerEnabled !== false
}

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
  scopes: Array.isArray(a.scopes) ? a.scopes.filter((s): s is string => typeof s === 'string') : []
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
      enabled: isProviderEnabled(p.transformer),
      accounts,
      activeAccount: active
    }
  })
}
