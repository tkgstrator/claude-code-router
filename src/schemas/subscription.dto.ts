import { z } from '@hono/zod-openapi'

// Normalised in-memory shape produced by the OAuth flow's
// recordXxxOAuthAccount helpers and consumed by the SubAccount upsert.
// Token fields are still plaintext here — encryption happens at the
// storage boundary in subscription-account-sync-service.
export const DiscoveredAccountSchema = z.object({
  sourcePath: z.string().nonempty(),
  label: z.string().nonempty(),
  userName: z.string().nonempty().nullable(),
  userEmail: z.string().nonempty().nullable(),
  userId: z.string().nonempty().nullable(),
  accountId: z.string().nonempty().nullable(),
  plan: z.string().nonempty().nullable(),
  rateLimitTier: z.string().nonempty().nullable(),
  monthlyPriceUsd: z.number().nullable(),
  expiresAt: z.date().nullable(),
  scopes: z.array(z.string().nonempty()),
  accessToken: z.string().nonempty().nullable(),
  refreshToken: z.string().nonempty().nullable(),
  idToken: z.string().nonempty().nullable()
})
export type DiscoveredAccount = z.infer<typeof DiscoveredAccountSchema>

export const SubscriptionInfoSchema = z
  .object({
    id: z.string().nonempty(),
    label: z.string().nonempty(),
    sourcePath: z.string().nonempty(),
    enabled: z.boolean(),
    userName: z.string().nonempty().nullable(),
    userEmail: z.string().nonempty().nullable(),
    userId: z.string().nonempty().nullable(),
    plan: z.string().nonempty().nullable(),
    rateLimitTier: z.string().nonempty().nullable(),
    monthlyPriceUsd: z.number().nullable(),
    expiresAt: z.number().nullable(),
    scopes: z.array(z.string().nonempty())
  })
  .openapi('SubscriptionAccountInfo')

export const SubscriptionProviderInfoSchema = z
  .object({
    providerName: z.string().nonempty(),
    enabled: z.boolean(),
    accounts: z.array(SubscriptionInfoSchema),
    activeAccount: SubscriptionInfoSchema.nullable()
  })
  .openapi('SubscriptionInfo')

export const SubscriptionsResponseSchema = z
  .object({
    subscriptions: z.array(SubscriptionProviderInfoSchema)
  })
  .openapi('SubscriptionsResponse')

export const EnabledModelSchema = z
  .object({
    provider: z.string().nonempty(),
    model: z.string().nonempty()
  })
  .openapi('EnabledModel')

export const EnabledModelsResponseSchema = z
  .object({
    models: z.array(EnabledModelSchema)
  })
  .openapi('EnabledModelsResponse')
