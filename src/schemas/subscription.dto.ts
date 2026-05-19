import { z } from '@hono/zod-openapi'

export const SubscriptionInfoSchema = z
  .object({
    id: z.string().nonempty(),
    label: z.string().nonempty(),
    sourcePath: z.string().nonempty(),
    enabled: z.boolean(),
    userName: z.string().nullable(),
    userEmail: z.string().nullable(),
    userId: z.string().nullable(),
    plan: z.string().nullable(),
    rateLimitTier: z.string().nullable(),
    expiresAt: z.number().nullable(),
    scopes: z.array(z.string().nonempty()).nullable()
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
