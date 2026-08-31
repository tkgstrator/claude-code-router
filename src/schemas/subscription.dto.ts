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
  // Access-token expiry — for both vendors. Codex reads it off the
  // token's own `exp` claim.
  expiresAt: z.date().nullable(),
  // When the paid subscription itself lapses. Codex only (from the
  // id_token's `chatgpt_subscription_active_until`); null for Claude,
  // which exposes no equivalent.
  subscriptionEndsAt: z.date().nullable(),
  scopes: z.array(z.string().nonempty()),
  accessToken: z.string().nonempty().nullable(),
  refreshToken: z.string().nonempty().nullable(),
  idToken: z.string().nonempty().nullable()
})
export type DiscoveredAccount = z.infer<typeof DiscoveredAccountSchema>

// Result of the last auth probe (token refresh + upstream profile/usage
// fetch). Mirrors the SubAccount.authStatus enum. `invalid` means the
// account needs re-authentication via the CLI.
export const AuthStatusSchema = z.enum(['unknown', 'live', 'invalid'])
export type AuthStatus = z.infer<typeof AuthStatusSchema>

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
    // Auto-refreshed access-token expiry, for both vendors. Not a health
    // signal on its own — a token at or past expiry is rotated on next
    // use; authStatus is the authoritative "does this authenticate" bit.
    expiresAt: z.number().nullable(),
    // Codex only: when the paid subscription lapses. Null for Claude.
    subscriptionEndsAt: z.number().nullable(),
    authStatus: AuthStatusSchema,
    authCheckedAt: z.number().nullable(),
    authError: z.string().nonempty().nullable(),
    scopes: z.array(z.string().nonempty())
  })
  .openapi('SubscriptionAccountInfo')

export const SubscriptionProviderInfoSchema = z
  .object({
    providerName: z.string().nonempty(),
    // Vendor family, derived from the provider's apiBaseUrl. Lets the UI
    // pick the right usage-window shape and group accounts without hard-
    // coding provider names.
    kind: z.enum(['claude', 'codex', 'other']),
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
