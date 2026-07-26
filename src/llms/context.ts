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
import type { Provider, ProviderConfigShape } from '@/schemas'
import { flattenNestedRouter } from '@/schemas'
import { logger } from '../logger'
import { loadFullConfig } from '../services/config'
import { applyOpenAIOverlay } from '../services/openai-overlay'
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

export type LlmsContext = {
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
  //    AppConfig.Providers is non-optional per the schema, so no nullish
  //    fallback is needed here.
  // api_key openai providers get OpenAITransformer mounted on the chain
  // (max_tokens → max_completion_tokens for gpt-5.x) plus a per-model
  // openai-responses override for codex models. Stays on the raw
  // payload — subscription overlay applies next on top.
  const rawProviders: Provider[] = applyOpenAIOverlay(cfg.Providers)
  const [activeAccountPaths, authByProvider] = await Promise.all([
    collectActiveAccountPaths(),
    collectAuthByProvider(rawProviders)
  ])
  const providersWithAuth = applySubscriptionAuth(rawProviders, activeAccountPaths, authByProvider)

  // 2. ConfigStore — the pipeline reads Router config, scenario thresholds,
  //    HTTPS_PROXY, etc. The router uses configService.get('providers') for
  //    "provider,model" resolution; keep that key (lowercase) populated alongside
  //    the schema-canonical capital Providers.
  // The wire/UI config carries the nested Router shape; the pipeline
  // reads the historical flat shape (per-scenario primary slots plus
  // sibling fallbacks / force maps and the two scalar knobs), so flatten
  // it here — the single boundary where nested config crosses into the
  // runtime ConfigStore. Per-project override files are already flat.
  const config = new ConfigStore({
    ...cfg,
    Providers: providersWithAuth,
    providers: providersWithAuth,
    Router: flattenNestedRouter(cfg.Router)
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
  providers.registerFromConfig(toProviderConfigShapes(providersWithAuth))

  // 5. Tokenizer registry — used by the scenario router to count tokens.
  const tokenizers = new TokenizerRegistry(logger)
  await tokenizers.initialize()

  return { config, transformers, providers, tokenizers, log: logger }
}

/**
 * Bridge Provider[] (the disk/DB shape with looser `api_key:
 * string | null` and the broader `use[]` union) into the registry input
 * shape ProviderConfigShape[]. registerFromConfig defensively skips
 * rows with falsy name/api_base_url/api_key, so the unused-null and
 * shape differences are runtime-safe; the structural mismatch is
 * unavoidable at the type layer because the two schemas describe the
 * same data at different boundaries.
 */
function toProviderConfigShapes(providers: Provider[]): ProviderConfigShape[] {
  return providers.map((p) => ({
    name: p.name,
    api_base_url: p.api_base_url,
    // biome-ignore plugin: api_key is nullable on the DB-shaped Provider but the
    // registry filters out null/empty rows in registerFromConfig; the empty-string
    // fallback keeps the type union narrow without a cast.
    api_key: p.api_key ?? '',
    models: p.models,
    // biome-ignore plugin: `transformer.use` entries are structurally the same on
    // both schemas (string | [string, options]) but the disk schema models them
    // with a wider union; this structural pass-through is the safe bridge.
    transformer: p.transformer as ProviderConfigShape['transformer']
  }))
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

async function collectAuthByProvider(providers: Provider[]): Promise<Map<string, SubscriptionAuthOverlay>> {
  const map = new Map<string, SubscriptionAuthOverlay>()
  for (const p of providers) {
    if (p.auth_mode !== 'subscription') continue
    const auth = await getActiveSubAccountAuth(p.name).catch(() => null)
    if (auth) map.set(p.name, auth)
  }
  return map
}
