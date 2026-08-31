/**
 * Overlay the request-pipeline transformer chain onto api_key OpenAI
 * providers.
 *
 * Two things happen here:
 *  - The provider gets `transformer.use = ['openai']` so the OpenAI
 *    transformer's request-side rewrites (e.g. max_tokens →
 *    max_completion_tokens for gpt-5.x) run. The endpoint transformer
 *    for inbound /v1/messages is still `anthropic`; this just slots
 *    OpenAITransformer into the provider chain.
 *  - Each codex-family model gets a per-model `use: ['openai-responses']`
 *    override. Codex models on the api_key openai provider are
 *    Responses-only upstream — without this override they 404 against
 *    /chat/completions. openai-responses redirects the upstream URL
 *    to /v1/responses when it sees a /chat/completions base.
 *
 * Subscription providers are owned by applySubscriptionAuth and are
 * skipped here. User-supplied per-model overrides win over the default
 * injection so an operator can still pin a custom chain.
 */

import type { Provider, ProviderTransformer } from '@/schemas/domain/provider'

const CODEX_MODEL = /codex/i

const isOpenAIBase = (apiBaseUrl: string): boolean =>
  /api\.openai\.com\//.test(apiBaseUrl) || /\/chat\/completions$/.test(apiBaseUrl)

export const applyOpenAIOverlay = (providers: Provider[]): Provider[] =>
  providers.map((p) => {
    if (p.auth_mode !== 'api_key') return p
    if (!isOpenAIBase(p.api_base_url)) return p

    const transformer: ProviderTransformer = { ...(p.transformer ?? {}) }

    // Don't clobber an operator-supplied use chain. If something is
    // already there, the operator knows what they want.
    if (!Array.isArray(transformer.use) || transformer.use.length === 0) {
      transformer.use = ['openai']
    }

    for (const model of p.models ?? []) {
      if (!CODEX_MODEL.test(model)) continue
      // Same deal: respect an existing per-model override.
      if (transformer[model] !== undefined) continue
      transformer[model] = { use: ['openai-responses'] }
    }

    return { ...p, transformer }
  })
