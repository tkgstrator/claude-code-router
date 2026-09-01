/**
 * Overlay OAuth credentials onto subscription Providers so the pipeline
 * can resolve them without skipping them for a missing api_key.
 *
 * Why this exists: subscription providers store no static api_key — the
 * real bearer token lives in a credentials file (and, since the
 * SubAccount table landed, in the DB) and is injected at request time by
 * a `*-oauth` transformer. The provider registry skips any provider with
 * a falsy api_key, so we hand them a placeholder string and graft the
 * credential onto `provider.transformer`, where the OAuth base reads it.
 *
 * Chain selection is NOT done here. The transformer chain is derived from
 * `Provider.apiStyle` + `Provider.authMode` in
 * `shared/transformer-chain.ts` and built by the registry. This overlay
 * only consults that derivation for one question: whether the provider is
 * servable at all. A subscription vendor this build has no auth
 * transformer for is left untouched, so it stays unregistered rather than
 * being called with a placeholder key.
 */

import type { Provider } from '@/schemas/domain/provider'
import { transformerChain } from '@/shared/transformer-chain'
// Mirror of getActiveSubAccountAuth's return shape. The pipeline overlay
// passes this object verbatim onto `provider.transformer.subscriptionAuth`
// where OAuthTransformer parses it back out with safeParse.
export interface SubscriptionAuthOverlay {
  subAccountId: string
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accountId: string | null
  expiresAt: Date | null
}

export const applySubscriptionAuth = (
  providers: Provider[],
  activeAccountPathByProvider: Map<string, string>,
  authByProvider: Map<string, SubscriptionAuthOverlay>
): Provider[] =>
  providers.map((p) => {
    if (p.auth_mode !== 'subscription' || p.enabled === false) return p
    if (transformerChain(p) === null) return p
    const subscriptionCredentialPath = activeAccountPathByProvider.get(p.name)
    const dbAuth = authByProvider.get(p.name)
    return {
      ...p,
      api_key: 'oauth',
      transformer: {
        ...(p.transformer ? p.transformer : {}),
        ...(subscriptionCredentialPath ? { subscriptionCredentialPath } : {}),
        ...(dbAuth ? { subscriptionAuth: dbAuth } : {})
      }
    }
  })
