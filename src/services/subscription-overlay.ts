/**
 * Overlay OAuth credentials onto subscription Providers so the vendored
 * llms pipeline can resolve them without the upstream ProviderService
 * skipping them for missing api_key.
 *
 * Why this exists: subscription providers store no static api_key — the
 * real bearer token lives in a credentials file and is injected at
 * request time by a `*-oauth` transformer. llms ProviderService skips
 * any provider with a falsy api_key, so we hand them a placeholder
 * string and graft the right transformer chain onto each provider.
 *
 * Chain selection:
 *  - claude-code is Anthropic-in / Anthropic-out. A single
 *    claude-code-oauth transformer is the sole `use`, which the llms
 *    pipeline runs in passthrough/bypass mode (its auth() hook injects
 *    the bearer token).
 *  - codex is OpenAI Responses-API style talking to the ChatGPT
 *    backend, so it CANNOT bypass: it needs the full chain
 *    (openai-responses) plus codex-oauth LAST for subscription auth +
 *    backend requirements. Two `use` entries means non-bypass, so the
 *    chain actually runs.
 */

import type { Provider } from '@/schemas/domain/provider'
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

const SUBSCRIPTION_TRANSFORMER_CHAIN: Record<string, string[]> = {
  'claude-code': ['claude-code-oauth'],
  codex: ['openai-responses', 'codex-oauth']
}

const chainForProvider = (p: Provider): string[] | undefined => {
  const named = SUBSCRIPTION_TRANSFORMER_CHAIN[p.name]
  if (named) return named
  // Fallback by base URL — covers self-hosted proxies that point at the
  // upstream vendor endpoint under a non-canonical provider name.
  const base = p.api_base_url
  if (base.includes('anthropic.com')) return ['claude-code-oauth']
  if (base.includes('chatgpt.com') || base.includes('openai.com/v1')) return ['openai-responses', 'codex-oauth']
  return undefined
}

export const applySubscriptionAuth = (
  providers: Provider[],
  activeAccountPathByProvider: Map<string, string>,
  authByProvider: Map<string, SubscriptionAuthOverlay>
): Provider[] =>
  providers.map((p) => {
    if (p.auth_mode !== 'subscription' || p.enabled === false) return p
    const use = chainForProvider(p)
    if (!use) return p
    const subscriptionCredentialPath = activeAccountPathByProvider.get(p.name)
    const dbAuth = authByProvider.get(p.name)
    return {
      ...p,
      api_key: 'oauth',
      transformer: {
        ...(p.transformer ?? {}),
        use,
        ...(subscriptionCredentialPath ? { subscriptionCredentialPath } : {}),
        ...(dbAuth ? { subscriptionAuth: dbAuth } : {})
      }
    }
  })
