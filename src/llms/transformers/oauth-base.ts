/**
 * Shared scaffolding for subscription-OAuth transformers (claude-code,
 * codex, …). Concrete subclasses implement the vendor's credential
 * file format (and any refresh policy); this base handles:
 *
 *   1. Credential file path resolution: honour
 *      `provider.transformer.subscriptionCredentialPath` when present,
 *      otherwise fall back to the vendor's default location.
 *   2. Token source preference: when the DB has already synced an
 *      access token (`provider.transformer.subscriptionAuth.accessToken`),
 *      use it; otherwise read from disk via `readFromDisk`.
 */

import type { OauthCredentials, OauthProviderTransformer, RuntimeProvider } from '@/schemas'
import { Transformer } from './base'

// Re-export the schema-derived credential type for transformer
// implementations that work in terms of "what readFromDisk returns".
export type { OauthCredentials } from '@/schemas'

export abstract class OAuthTransformer extends Transformer {
  protected abstract readonly defaultCredentialPath: string

  /**
   * Vendor-specific reader: parse the on-disk credential file and
   * return the access token (+ optional accountId). Claude's impl also
   * refreshes near-expiry tokens; codex's is a plain read.
   */
  protected abstract readFromDisk(path: string): Promise<OauthCredentials>

  protected resolveCredentialsPath(provider: RuntimeProvider | null | undefined): string {
    const tx = readOauthTransformer(provider)
    const override = tx?.subscriptionCredentialPath
    if (typeof override === 'string' && override.length > 0) return override
    return this.defaultCredentialPath
  }

  /**
   * Resolve credentials for THIS request. DB-synced token wins
   * (kept current by subscription-account-sync-service); disk fallback
   * handles the boot-time / unmigrated case.
   */
  protected async resolveSubscriptionAuth(provider: RuntimeProvider | null | undefined): Promise<OauthCredentials> {
    const tx = readOauthTransformer(provider)
    const auth = tx?.subscriptionAuth
    const dbToken = typeof auth?.accessToken === 'string' ? auth.accessToken : ''
    if (dbToken.length > 0) {
      const dbAccountId = typeof auth?.accountId === 'string' ? auth.accountId : undefined
      return { token: dbToken, accountId: dbAccountId }
    }
    return this.readFromDisk(this.resolveCredentialsPath(provider))
  }
}

function readOauthTransformer(provider: RuntimeProvider | null | undefined): OauthProviderTransformer | undefined {
  const tx = provider?.transformer
  if (tx === undefined || tx === null || typeof tx !== 'object') return undefined
  // The pipeline / overlay layer always populates `transformer` as a
  // plain object with optional `subscriptionCredentialPath` /
  // `subscriptionAuth` siblings (alongside the resolved `use[]`).
  // OauthProviderTransformer narrows just those fields without
  // re-asserting at every access site.
  const out: OauthProviderTransformer = {}
  const path = Reflect.get(tx, 'subscriptionCredentialPath')
  if (path !== undefined) out.subscriptionCredentialPath = path
  const auth = Reflect.get(tx, 'subscriptionAuth')
  if (auth !== null && typeof auth === 'object') {
    out.subscriptionAuth = {
      accessToken: Reflect.get(auth, 'accessToken'),
      refreshToken: Reflect.get(auth, 'refreshToken'),
      idToken: Reflect.get(auth, 'idToken'),
      accountId: Reflect.get(auth, 'accountId')
    }
  }
  return out
}
