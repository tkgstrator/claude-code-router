/**
 * Shared types for the scenario router split.
 *
 * `ConfigProvider` / `isProviderRegistrable` are used by both the
 * failover walker (`failover.ts`) and the model-selection heuristics
 * (`model-selection.ts`); the `Router*` types are the router's public
 * request/context shapes, re-exported from the top-level
 * `scenario-router.ts` for external callers.
 */

import type { Logger } from 'pino'
import type { ScenarioRouterConfig, ScenarioType } from '@/schemas'
import type { ConfigStore } from '../registry/config'
import type { TokenizerRegistry } from '../registry/tokenizer'
import type { TokenizeMessage, TokenizeSystem, TokenizeTool } from '../tokenizers/base'

// Local, un-renamed alias so the rest of the scenario-router split can
// `import type { RouterConfig } from './types'` — importing the schema
// type directly under an `as` rename trips the no-type-assertion plugin
// (it pattern-matches `$expr as $type` generically, including import
// rename specifiers).
export type RouterConfig = ScenarioRouterConfig

export type RouterRequestBody = {
  model: string
  messages?: TokenizeMessage[]
  system?: TokenizeSystem
  tools?: TokenizeTool[]
  thinking?: unknown
  metadata?: { user_id?: string }
  output_config?: Record<string, unknown>
  [extra: string]: unknown
}

export type RouterRequest = {
  body: RouterRequestBody
  log: Logger
  sessionId?: string
  // Inbound wire endpoint the request arrived on (e.g. `/v1/messages`,
  // `/v1/chat/completions`, `/v1/responses`). CCR-idiom mutations that
  // only make sense for the Anthropic client (persona injection notably)
  // gate on this: OpenAI-shape callers get the exact request they sent,
  // Anthropic-shape callers still get the enrichments Claude Code
  // expects. Absent for pre-existing test callers that predate this
  // hook — treated as "unknown, apply everything" for backward-compat.
  inboundPath?: string
  scenarioType?: ScenarioType
  tokenCount?: number
  // Set by selectModel: true when the request carried a
  // <CCR-SUBAGENT-MODEL> tag, so the pipeline routes and fails over on the
  // scenario's `subagent` route instead of the `agent` route.
  isSubagent?: boolean
  // Set by selectModel: the fallback chain to walk for this request. When
  // a route rule matched, this holds the rule's own fallbacks; otherwise
  // it holds the scenario's catch-all chain. Both the proactive
  // (applyProactiveFailover) and reactive (buildFailoverChain) failover
  // paths read this rather than re-deriving the chain by scenario, so a
  // rule-selected primary walks the rule-owned chain instead of the
  // scenario default.
  resolvedFallbacks?: string[]
  // Set by the quota-aware dispatcher when every candidate in the
  // preference chain failed the selector's gates AND the profile's
  // `exhaustedBehavior` is '429'. Non-null value is the number of
  // seconds until the earliest binding-window reset — the caller
  // returns a 429 with `Retry-After: <seconds>` instead of dispatching
  // upstream. Absent for scenario-router and passthrough branches.
  quotaExhaustedRetryAfterSec?: number
}

export type RouterContext = {
  config: ConfigStore
  tokenizers: TokenizerRegistry
}

export type ConfigProvider = {
  name: string
  models?: string[]
  api_base_url?: string
  // Mirrors ProviderRegistry.registerFromConfig — when this is absent or
  // empty, the registry silently skips the provider, so the router must
  // skip it too or the chain walker hits "provider not found; skipping".
  api_key?: string | null
  auth_mode?: string
  // Per-model context window (tokens), emitted by compose.ts. Used by the
  // capability gate so failover never lands on a model that cannot hold
  // the request. Absent entry = unknown window = allow (conservative).
  modelContextWindows?: Record<string, number>
}

// A provider is usable only when the ProviderRegistry would accept it
// at runtime. Subscription providers ride through applySubscriptionAuth
// which stamps `api_key: 'oauth'` before ProviderRegistry sees them,
// so the missing-api_key check would falsely reject them here (the test
// fixtures and the router both predate the overlay). Treat subscription
// providers as registrable unconditionally; for api_key providers we
// keep the original sanity check.
export function isProviderRegistrable(p: ConfigProvider): boolean {
  if (!p.name || !p.api_base_url) return false
  if (p.auth_mode === 'subscription') return true
  return Boolean(p.api_key)
}
