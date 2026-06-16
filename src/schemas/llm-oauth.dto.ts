/**
 * OAuth schemas consumed by the OAuth transformers (claude-code-oauth,
 * codex-oauth) at request time: the upstream refresh response, the
 * Anthropic /api/oauth/profile envelope, and the runtime overlay block
 * the pipeline grafts onto `provider.transformer.subscriptionAuth`.
 *
 * These all cross a trust boundary (HTTP response, pipeline overlay).
 * Schemas are strict so safeParse failures surface as HTTPException at
 * the transformer layer.
 */

import { z } from '@hono/zod-openapi'

// ─── Anthropic OAuth refresh response ──────────────────────────────────

export const OauthRefreshResponseSchema = z.object({
  access_token: z.string().nonempty(),
  refresh_token: z.string().nonempty().optional(),
  expires_in: z.number().int().nonnegative().optional()
})
export type OauthRefreshResponse = z.infer<typeof OauthRefreshResponseSchema>

// ─── Anthropic OAuth profile response ──────────────────────────────────
//
// GET https://api.anthropic.com/api/oauth/profile (with the
// `anthropic-beta: oauth-2025-04-20` header). Used to enrich the
// SubAccount row with user-facing identity (uuid / email / display name)
// since the on-disk `.credentials.json` never carries those fields.
// Optional surfaces lean toward "anthropic could add or rename here";
// the discriminator fields we actually depend on (`account.uuid`,
// `account.email`) are required.
export const ClaudeOAuthProfileAccountSchema = z.object({
  uuid: z.string().nonempty(),
  full_name: z.string().nonempty().optional(),
  display_name: z.string().nonempty().optional(),
  email: z.string().nonempty(),
  has_claude_max: z.boolean().optional(),
  has_claude_pro: z.boolean().optional()
})

export const ClaudeOAuthProfileOrganizationSchema = z.object({
  uuid: z.string().nonempty(),
  name: z.string().nonempty().optional(),
  organization_type: z.string().nonempty().optional(),
  billing_type: z.string().nonempty().optional(),
  rate_limit_tier: z.string().nonempty().optional(),
  has_extra_usage_enabled: z.boolean().optional(),
  subscription_status: z.string().nonempty().optional()
})

export const ClaudeOAuthProfileSchema = z.object({
  account: ClaudeOAuthProfileAccountSchema,
  organization: ClaudeOAuthProfileOrganizationSchema.optional(),
  application: z
    .object({
      uuid: z.string().nonempty(),
      name: z.string().nonempty().optional(),
      slug: z.string().nonempty().optional()
    })
    .optional()
})
export type ClaudeOAuthProfile = z.infer<typeof ClaudeOAuthProfileSchema>

// ─── Runtime credential / overlay shapes used by the OAuth base class ──

/**
 * Resolved OAuth credentials handed to a transformer at request time.
 * `token` is always present; `accountId` is codex-specific (used in the
 * `chatgpt-account-id` request header).
 */
export const OauthCredentialsSchema = z.object({
  token: z.string().nonempty(),
  accountId: z.string().nonempty().optional()
})
export type OauthCredentials = z.infer<typeof OauthCredentialsSchema>

/**
 * The `subscriptionAuth` block the pipeline overlays onto
 * `provider.transformer` from the DB-synced credentials table. Every
 * field is `unknown` because the source rows can contain decryption
 * failures (nulls) the OAuth base narrows defensively before use.
 */
// Strict shape — every field is parsed and narrowed here so the OAuth
// base can just read off `.data` instead of re-checking each property.
// `accessToken` is required at the type level even though the wire
// always carries it; the base treats an empty parse failure as "no
// active subscription account" and refuses to proceed.
// `expiresAt` accepts ISO strings (overlay round-trip) and Dates
// (direct Prisma row) via z.coerce.date.
export const OauthSubscriptionAuthBlockSchema = z.object({
  subAccountId: z.string().nonempty(),
  accessToken: z.string().nonempty(),
  refreshToken: z.string().nonempty().nullable().optional(),
  idToken: z.string().nonempty().nullable().optional(),
  accountId: z.string().nonempty().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional()
})
export type OauthSubscriptionAuthBlock = z.infer<typeof OauthSubscriptionAuthBlockSchema>

/**
 * The fields the OAuth transformers read off `provider.transformer`
 * (alongside the resolved `use[]` chain).
 */
export const OauthProviderTransformerSchema = z.object({
  subscriptionCredentialPath: z.unknown().optional(),
  subscriptionAuth: OauthSubscriptionAuthBlockSchema.optional()
})
export type OauthProviderTransformer = z.infer<typeof OauthProviderTransformerSchema>

// ─── Credential file import schemas ────────────────────────────────────
//
// Accepted formats for POST /api/oauth/import-credentials.

const ClaudeTokensSchema = z.object({
  accessToken: z.string().nonempty(),
  refreshToken: z.string().default(''),
  expiresAt: z.number().nullable().optional(),
  scopes: z.array(z.string()).optional()
})

// ~/.claude/.credentials.json wraps tokens under a `claudeAiOauth` key;
// the flat variant is also accepted for convenience.
export const ClaudeCredentialsFileSchema = z.union([
  z.object({ claudeAiOauth: ClaudeTokensSchema }).transform((v) => v.claudeAiOauth),
  ClaudeTokensSchema
])
export type ClaudeCredentialsFile = z.infer<typeof ClaudeCredentialsFileSchema>

// ~/.codex/auth.json nests tokens under a `tokens` key using snake_case.
export const CodexCredentialsFileSchema = z
  .object({
    tokens: z.object({
      access_token: z.string().nonempty(),
      refresh_token: z.string().default(''),
      id_token: z.string().nonempty()
    })
  })
  .transform((v) => ({
    accessToken: v.tokens.access_token,
    refreshToken: v.tokens.refresh_token,
    idToken: v.tokens.id_token
  }))
export type CodexCredentialsFile = z.infer<typeof CodexCredentialsFileSchema>

// ─── PackageJson (codex CLI version probe) ─────────────────────────────

/** Minimal `package.json` shape codex-oauth reads to fingerprint the
 *  installed @openai/codex package version. */
export const PackageJsonSchema = z.object({
  version: z.string().nonempty()
})
export type PackageJson = z.infer<typeof PackageJsonSchema>
