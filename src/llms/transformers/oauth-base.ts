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

import type { RuntimeProvider } from '../types'
import { Transformer } from './base'

export interface OauthCredentials {
  token: string
  /** Codex needs the ChatGPT account id for the chatgpt-account-id header. */
  accountId?: string
}

interface SubscriptionAuthBlock {
  accessToken?: unknown
  refreshToken?: unknown
  idToken?: unknown
  accountId?: unknown
}

interface OauthProviderTransformer {
  subscriptionCredentialPath?: unknown
  subscriptionAuth?: SubscriptionAuthBlock
}

export abstract class OAuthTransformer extends Transformer {
  protected abstract readonly defaultCredentialPath: string

  /**
   * Vendor-specific reader: parse the on-disk credential file and
   * return the access token (+ optional accountId). Claude's impl also
   * refreshes near-expiry tokens; codex's is a plain read.
   */
  protected abstract readFromDisk(path: string): Promise<OauthCredentials>

  protected resolveCredentialsPath(provider: RuntimeProvider | null | undefined): string {
    const tx = provider?.transformer as OauthProviderTransformer | undefined
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
    const tx = provider?.transformer as OauthProviderTransformer | undefined
    const auth = tx?.subscriptionAuth
    const dbToken = typeof auth?.accessToken === 'string' ? auth.accessToken : ''
    if (dbToken.length > 0) {
      const dbAccountId = typeof auth?.accountId === 'string' ? auth.accountId : undefined
      return { token: dbToken, accountId: dbAccountId }
    }
    return this.readFromDisk(this.resolveCredentialsPath(provider))
  }
}
