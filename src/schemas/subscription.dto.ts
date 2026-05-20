import { z } from '@hono/zod-openapi'

// Vendor credential-file wire shapes. We're lenient about unknown
// keys (vendors add fields over time) but strict about the
// discriminating shape — Codex must carry tokens with at least
// one of access_token / id_token, and Claude must carry the
// claudeAiOauth block. An entry that fails validation is skipped
// (with a warn log) instead of taking down the whole sync.
export const CodexTokensSchema = z
  .object({
    access_token: z.string().nonempty().optional(),
    refresh_token: z.string().nonempty().optional(),
    id_token: z.string().nonempty().optional(),
    account_id: z.string().nonempty().optional(),
    user_id: z.string().nonempty().optional()
  })
  .refine((t) => Boolean(t.access_token) || Boolean(t.id_token), {
    message: 'tokens must include access_token or id_token'
  })

export const CodexAuthEntrySchema = z.object({ tokens: CodexTokensSchema })

export const ClaudeOAuthSchema = z.object({
  accessToken: z.string().nonempty().optional(),
  refreshToken: z.string().nonempty().optional(),
  expiresAt: z.number().optional(),
  scopes: z.array(z.string().nonempty()).default([]),
  subscriptionType: z.string().nonempty().optional(),
  rateLimitTier: z.string().nonempty().optional()
})

export const ClaudeAccountEntrySchema = z.object({
  claudeAiOauth: ClaudeOAuthSchema,
  user: z
    .object({
      name: z.string().nonempty().optional(),
      email: z.string().nonempty().optional(),
      id: z.string().nonempty().optional()
    })
    .optional(),
  email: z.string().nonempty().optional(),
  organizationUuid: z.string().nonempty().optional()
})

// Each vendor file is read as either a single account object or an
// array of them. Array form is how operators express multiple
// accounts in one file; single-object form is the original Codex /
// Claude CLI layout and stays as-is for backward compatibility.
export const CredentialFileShapeSchema = z.union([z.array(z.unknown()), z.record(z.string().nonempty(), z.unknown())])

// Normalised in-memory shape produced by the credential file readers
// and consumed by the sync upsert. Token fields are still plaintext
// here — encryption happens at the storage boundary.
export const DiscoveredAccountSchema = z.object({
  sourcePath: z.string().nonempty(),
  label: z.string().nonempty(),
  userName: z.string().nonempty().nullable(),
  userEmail: z.string().nonempty().nullable(),
  userId: z.string().nonempty().nullable(),
  accountId: z.string().nonempty().nullable(),
  plan: z.string().nonempty().nullable(),
  rateLimitTier: z.string().nonempty().nullable(),
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

// Strict credential-file shapes used by the model connectivity test:
// only the access_token field is read, and the test must fail-fast on
// anything that isn't a non-empty string. Distinct from the looser
// schemas in usage.dto.ts (which validate the same files for the usage
// capture path but tolerate unknown sibling values).
export const ClaudeOauthCredentialFileSchema = z.object({
  claudeAiOauth: z
    .object({
      accessToken: z.string().nonempty().optional(),
      expiresAt: z.number().optional()
    })
    .optional()
})

export const CodexAuthCredentialFileSchema = z.object({
  tokens: z
    .object({
      access_token: z.string().nonempty().optional(),
      account_id: z.string().nonempty().optional()
    })
    .optional()
})
