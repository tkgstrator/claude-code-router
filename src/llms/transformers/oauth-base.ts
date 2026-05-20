/**
 * Shared scaffolding for subscription-OAuth transformers (claude-code,
 * codex, …). All credential reads come from the DB-synced overlay on
 * `provider.transformer.subscriptionAuth` — there is no disk fallback.
 * Concrete subclasses opt into a near-expiry refresh by overriding
 * `refresh()`; the base owns the in-flight dedup so concurrent requests
 * don't race the upstream refresh endpoint with the same single-use
 * refresh_token.
 */

import { HTTPException } from 'hono/http-exception'
import { type OauthCredentials, OauthSubscriptionAuthBlockSchema, type RuntimeProvider } from '@/schemas'
import { updateSubAccountAccessToken } from '../../services/subscription-account-sync-service'
import { Transformer } from './base'

export type { OauthCredentials } from '@/schemas'

export interface OAuthRefreshResult {
  accessToken: string
  refreshToken?: string | null
  expiresAt?: Date | null
}

// Refresh ~5 minutes before the upstream-stated expiry so a long-running
// request started right at the threshold doesn't 401 mid-flight.
const REFRESH_LEEWAY_MS = 5 * 60 * 1000

const refreshInFlight = new Map<string, Promise<string>>()

export abstract class OAuthTransformer extends Transformer {
  /**
   * Vendor-specific refresh hook. Default is "no refresh" — the
   * transformer relies on the user re-running OAuth before the token
   * expires. Override to hit the vendor's refresh endpoint with the
   * stored refresh_token and return the rotated grant.
   */
  protected async refresh(_input: { refreshToken: string }): Promise<OAuthRefreshResult | null> {
    return null
  }

  protected async resolveSubscriptionAuth(provider: RuntimeProvider | null | undefined): Promise<OauthCredentials> {
    const parsed = OauthSubscriptionAuthBlockSchema.safeParse(
      // biome-ignore plugin: provider.transformer is the pipeline-owned `Record<string, unknown>` overlay; safeParse narrows the subscriptionAuth block from there.
      (provider?.transformer as Record<string, unknown> | undefined)?.subscriptionAuth
    )
    if (!parsed.success) {
      throw new HTTPException(401, {
        message:
          'No active subscription account for this provider. Sign in via Settings → Providers → Connect, then retry.'
      })
    }
    const auth = parsed.data
    const live = await this.refreshIfNearExpiry({
      subAccountId: auth.subAccountId,
      accessToken: auth.accessToken,
      refreshToken: typeof auth.refreshToken === 'string' ? auth.refreshToken : '',
      expiresAt: auth.expiresAt ?? null
    })
    const accountId = typeof auth.accountId === 'string' ? auth.accountId : undefined
    return accountId ? { token: live, accountId } : { token: live }
  }

  private async refreshIfNearExpiry(auth: {
    subAccountId: string
    accessToken: string
    refreshToken: string
    expiresAt: Date | null
  }): Promise<string> {
    if (auth.expiresAt === null) return auth.accessToken
    if (auth.expiresAt.valueOf() - Date.now() > REFRESH_LEEWAY_MS) return auth.accessToken
    if (auth.refreshToken.length === 0) return auth.accessToken

    const existing = refreshInFlight.get(auth.subAccountId)
    if (existing) return existing

    const inFlight = (async () => {
      try {
        const next = await this.refresh({ refreshToken: auth.refreshToken })
        if (!next) return auth.accessToken
        await updateSubAccountAccessToken(auth.subAccountId, {
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          expiresAt: next.expiresAt
        })
        return next.accessToken
      } catch {
        // Refresh failures fall back to the existing access token; the
        // upstream call will likely 401 and the user re-authenticates.
        return auth.accessToken
      } finally {
        refreshInFlight.delete(auth.subAccountId)
      }
    })()
    refreshInFlight.set(auth.subAccountId, inFlight)
    return inFlight
  }
}
