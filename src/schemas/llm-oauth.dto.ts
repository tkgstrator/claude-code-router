/**
 * OAuth credential file shapes + the upstream refresh response, as
 * consumed by the OAuth transformers (claude-code-oauth, codex-oauth)
 * at request time.
 *
 * These all cross a trust boundary (disk file written by an external
 * CLI, HTTP response from the OAuth provider). The schemas are strict
 * (required fields are real types, not z.unknown) so safeParse failures
 * surface as HTTPException at the transformer layer.
 *
 * Note: the lax `ClaudeCredentialsSchema` / `CodexAuthFileSchema` in
 * usage.dto.ts serve a different consumer (background usage-info
 * service) which tolerates missing fields. The transformer schemas
 * here intentionally use the `Oauth*` prefix to avoid the barrel
 * collision while making the consumer obvious.
 */

import { z } from '@hono/zod-openapi'

// ─── Claude Code credentials file (~/.claude/.credentials.json) ────────

export const OauthClaudeBlockSchema = z.object({
  accessToken: z.string().nonempty(),
  refreshToken: z.string().nonempty(),
  expiresAt: z.number().int().nonnegative(),
  scopes: z.array(z.string().nonempty()).default([]),
  subscriptionType: z.string().nonempty().optional(),
  rateLimitTier: z.string().nonempty().optional()
})
export type OauthClaudeBlock = z.infer<typeof OauthClaudeBlockSchema>

export const OauthClaudeCredentialsSchema = z.object({
  claudeAiOauth: OauthClaudeBlockSchema,
  organizationUuid: z.string().nonempty().optional()
})
export type OauthClaudeCredentials = z.infer<typeof OauthClaudeCredentialsSchema>

// ─── Anthropic OAuth refresh response ──────────────────────────────────

export const OauthRefreshResponseSchema = z.object({
  access_token: z.string().nonempty(),
  refresh_token: z.string().nonempty().optional(),
  expires_in: z.number().int().nonnegative().optional()
})
export type OauthRefreshResponse = z.infer<typeof OauthRefreshResponseSchema>

// ─── Codex credentials file (~/.codex/auth.json) ───────────────────────
//
// The codex CLI writes a nested `{ tokens: { access_token, account_id } }`
// shape. We reject files missing tokens.access_token at parse time so
// the transformer sees a typed credential object or an HTTPException.

export const OauthCodexAuthFileSchema = z.object({
  tokens: z.object({
    access_token: z.string().nonempty(),
    account_id: z.string().nonempty().optional()
  })
})
export type OauthCodexAuthFile = z.infer<typeof OauthCodexAuthFileSchema>

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
export const OauthSubscriptionAuthBlockSchema = z.object({
  accessToken: z.unknown().optional(),
  refreshToken: z.unknown().optional(),
  idToken: z.unknown().optional(),
  accountId: z.unknown().optional()
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

// ─── PackageJson (codex CLI version probe) ─────────────────────────────

/** Minimal `package.json` shape codex-oauth reads to fingerprint the
 *  installed @openai/codex package version. */
export const PackageJsonSchema = z.object({
  version: z.string().nonempty()
})
export type PackageJson = z.infer<typeof PackageJsonSchema>
