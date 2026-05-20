/**
 * Process-wide singleton tying together the registries the pipeline
 * needs (transformers, providers, tokenizers, config). Replaces the
 * legacy llms-context.ts shim around the vendor Server constructor.
 *
 * The context is built lazily on first request and rebuilt whenever
 * the DB-backed Providers / Router config changes — call
 * `resetLlmsContext()` after a config mutation to force a fresh build.
 */

import type { Logger } from 'pino'
import { logger } from '../logger'
import type { Provider as SchemaProvider } from '../schemas'
import { loadFullConfig } from '../services/config'
import { getActiveSubAccountAuth } from '../services/subscription-account-sync-service'
import { getSubscriptionsInfo } from '../services/subscription-info-service'
import { applySubscriptionAuth, type SubscriptionAuthOverlay } from '../services/subscription-overlay'
import { ConfigStore } from './registry/config'
import { ProviderRegistry } from './registry/provider'
import { TokenizerRegistry } from './registry/tokenizer'
import { TransformerRegistry } from './registry/transformer'
import { AnthropicTransformer } from './transformers/anthropic'
import { ClaudeCodeOauthTransformer } from './transformers/claude-code-oauth'
import { CodexOauthTransformer } from './transformers/codex-oauth'
import { GeminiTransformer } from './transformers/gemini'
import { OpenAITransformer } from './transformers/openai'
import { OpenAIResponsesTransformer } from './transformers/openai-responses'
import type { ProviderConfigShape } from './types'

export interface LlmsContext {
  config: ConfigStore
  transformers: TransformerRegistry
  providers: ProviderRegistry
  tokenizers: TokenizerRegistry
  log: Logger
}

let ctxPromise: Promise<LlmsContext> | null = null

export function getLlmsContext(): Promise<LlmsContext> {
  if (!ctxPromise) ctxPromise = buildLlmsContext()
  return ctxPromise
}

/** Force a rebuild after DB-backed config (Providers / Router) changes. */
export function resetLlmsContext(): void {
  ctxPromise = null
}

async function buildLlmsContext(): Promise<LlmsContext> {
  const cfg = await loadFullConfig()

  // 1. Subscription overlay — inject OAuth credentials onto subscription
  //    providers so the OAuth transformers can read them at request time.
  const rawProviders: SchemaProvider[] = cfg.Providers ?? []
  const [activeAccountPaths, authByProvider] = await Promise.all([
    collectActiveAccountPaths(),
    collectAuthByProvider(rawProviders)
  ])
  const providersWithAuth = applySubscriptionAuth(rawProviders, activeAccountPaths, authByProvider)

  // 2. ConfigStore — the pipeline reads Router config, scenario thresholds,
  //    HTTPS_PROXY, etc. The router uses configService.get('providers') for
  //    "provider,model" resolution; keep that key (lowercase) populated alongside
  //    the schema-canonical capital Providers.
  const config = new ConfigStore({
    ...cfg,
    Providers: providersWithAuth,
    providers: providersWithAuth,
    Router: cfg.Router
  })

  // 3. Transformer registry — instantiate the 6 supported transformers.
  const transformers = new TransformerRegistry(logger)
  transformers.registerMany([
    new AnthropicTransformer(),
    new OpenAITransformer(),
    new OpenAIResponsesTransformer(),
    new GeminiTransformer(),
    new ClaudeCodeOauthTransformer(),
    new CodexOauthTransformer()
  ])

  // 4. Provider registry — resolve each provider's transformer chain
  //    against the freshly-built transformer registry.
  const providers = new ProviderRegistry(transformers, logger)
  providers.registerFromConfig(providersWithAuth as unknown as ProviderConfigShape[])

  // 5. Tokenizer registry — used by the scenario router to count tokens.
  const tokenizers = new TokenizerRegistry(logger)
  await tokenizers.initialize()

  return { config, transformers, providers, tokenizers, log: logger }
}

// ─── Subscription overlay collection ───────────────────────────────────

async function collectActiveAccountPaths(): Promise<Map<string, string>> {
  const subscriptions = await getSubscriptionsInfo()
  const map = new Map<string, string>()
  for (const s of subscriptions) {
    const path = s.activeAccount?.sourcePath
    if (path) map.set(s.providerName, path)
  }
  return map
}

async function collectAuthByProvider(providers: SchemaProvider[]): Promise<Map<string, SubscriptionAuthOverlay>> {
  const map = new Map<string, SubscriptionAuthOverlay>()
  for (const p of providers) {
    if (p.auth_mode !== 'subscription') continue
    const auth = await getActiveSubAccountAuth(p.name).catch(() => null)
    if (auth) map.set(p.name, auth)
  }
  return map
}
