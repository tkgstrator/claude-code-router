// @ts-nocheck
/**
 * Standalone @musistudio/llms service context — no Fastify.
 *
 * Mirrors what the llms Server constructor builds (ConfigService /
 * TransformerService / TokenizerService / ProviderService) so the Hono
 * /v1 adapter can drive the exact same router + transformer pipeline
 * (src/llms) directly, in-process, without booting Fastify (whose
 * listen()/avvio lifecycle hangs inside the Vite SSR runner).
 *
 * @ts-nocheck + tsconfig maps @/llms/* to an any-stub, so the strict
 * root typecheck never traverses the vendored llms graph. Vite
 * resolves @/llms/* to the real source at runtime via its own alias.
 */

import { handleTransformerEndpoint } from '@/llms/api/routes'
import { ConfigService } from '@/llms/services/config'
import { ProviderService } from '@/llms/services/provider'
import { TokenizerService } from '@/llms/services/tokenizer'
import { TransformerService } from '@/llms/services/transformer'
import { router } from '@/llms/utils/router'
import { logger } from './lib/logger'
import { loadFullConfig } from './services/configService'
import { getActiveSubAccountAuth } from './services/subscriptionAccountSyncService'
import { getSubscriptionsInfo } from './services/subscriptionInfoService'

// Re-export the pipeline entrypoints through this @ts-nocheck module so
// the strict Hono adapter can import them as `any` (the @/llms/* stub
// can't satisfy named imports directly).
export { handleTransformerEndpoint, router }

// pino-shaped logger the llms code expects on fastify.log. Previously
// info/debug/trace were dropped on the floor and warn/error only hit
// the console; now everything goes through the shared JSON-lines
// logger (file + console, level-gated by LOG_LEVEL) so provider
// errors, routing decisions and the per-request LLM metadata are
// actually visible / inspectable in the UI's LogViewer.
const log: any = logger

export interface LlmsContext {
  configService: any
  transformerService: any
  tokenizerService: any
  providerService: any
  log: any
}

let ctxPromise: Promise<LlmsContext> | null = null

// Subscription providers store no api_key (the OAuth token lives in a
// credentials file); the real token is injected at request time by a
// credentials transformer. llms ProviderService skips any provider
// with a falsy api_key, so we give such providers a placeholder key
// plus the right transformer chain.
//
// claude-code is Anthropic in / Anthropic out — a single credentials
// transformer makes it the sole `use`, which the llms pipeline runs in
// passthrough/bypass mode (its auth() hook injects the bearer token).
//
// codex is OpenAI Responses-API style talking to the ChatGPT backend,
// so it CAN'T bypass: it needs the full transform chain (the anthropic
// endpoint transformer -> openai-responses) plus codex-oauth
// LAST to add the subscription auth + backend requirements. Two `use`
// entries means non-bypass, so the chain actually runs.
const SUBSCRIPTION_TRANSFORMER_CHAIN: Record<string, string[]> = {
  'claude-code': ['claude-code-oauth'],
  codex: ['openai-responses', 'codex-oauth']
}

const subscriptionTransformerChainForProvider = (p: any): string[] | undefined => {
  if (!p) return undefined
  if (typeof p.name === 'string' && SUBSCRIPTION_TRANSFORMER_CHAIN[p.name]) {
    return SUBSCRIPTION_TRANSFORMER_CHAIN[p.name]
  }
  const base = String(p.api_base_url ?? p.apiBaseUrl ?? '')
  if (base.includes('anthropic.com')) return ['claude-code-oauth']
  if (base.includes('chatgpt.com') || base.includes('openai.com/v1')) return ['openai-responses', 'codex-oauth']
  return undefined
}

const withSubscriptionAuth = (
  providers: any[],
  activeAccountPathByProvider: Map<string, string>,
  authByProvider: Map<
    string,
    { accessToken: string | null; refreshToken: string | null; idToken: string | null; accountId: string | null }
  >
): any[] =>
  providers.map((p) => {
    if (p?.auth_mode !== 'subscription') return p
    if (p?.enabled === false) return p
    const use = subscriptionTransformerChainForProvider(p)
    if (!use) return p
    const subscriptionCredentialPath = activeAccountPathByProvider.get(String(p.name))
    const dbAuth = authByProvider.get(String(p.name))
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

async function build(): Promise<LlmsContext> {
  const cfg = await loadFullConfig()
  const subscriptions = await getSubscriptionsInfo()
  const activeAccountPathByProvider = new Map(
    subscriptions
      .filter((s) => s.activeAccount?.sourcePath)
      .map((s) => [s.providerName, s.activeAccount?.sourcePath as string])
  )
  const authByProvider = new Map<
    string,
    { accessToken: string | null; refreshToken: string | null; idToken: string | null; accountId: string | null }
  >()
  for (const p of (cfg as any).Providers ?? []) {
    if (p?.auth_mode !== 'subscription') continue
    const auth = await getActiveSubAccountAuth(String(p.name)).catch(() => null)
    if (auth) authByProvider.set(String(p.name), auth)
  }
  const providers = withSubscriptionAuth((cfg as any).Providers ?? [], activeAccountPathByProvider, authByProvider)
  // router.ts reads configService.get("providers") (lowercase) and
  // get("Router"); loadFullConfig returns capital Providers. Provide
  // both so explicit "provider,model" routing also works.
  const initialConfig = { ...cfg, Providers: providers, providers, Router: (cfg as any).Router }
  const configService = new ConfigService({ initialConfig })
  const transformerService = new TransformerService(configService, log)
  const tokenizerService = new TokenizerService(configService, log)
  await transformerService.initialize()
  await tokenizerService.initialize().catch((e: unknown) => log.error('tokenizer init failed', e))
  const providerService = new ProviderService(configService, transformerService, log)
  return { configService, transformerService, tokenizerService, providerService, log }
}

export function getLlmsContext(): Promise<LlmsContext> {
  if (!ctxPromise) ctxPromise = build()
  return ctxPromise
}

// Force a rebuild after the DB config changes (provider/model edits).
export function resetLlmsContext(): void {
  ctxPromise = null
}
