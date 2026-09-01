/**
 * A subscription-backed account (Claude Max, ChatGPT Plus, …) as the
 * OAuth flow discovers it and the SubAccount table stores it.
 *
 * Domain rather than api because the tokens on DiscoveredAccount are
 * plaintext at this point — the shape that goes over /api/subscriptions
 * (api/subscriptions.ts) deliberately carries none of them.
 */

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
