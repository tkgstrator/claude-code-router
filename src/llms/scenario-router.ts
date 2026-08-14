/**
 * Scenario-based model routing.
 *
 * Reads the inbound request and the configured `Router` map (default /
 * think / longContext / webSearch / image) and rewrites `body.model` to
 * the model the request should actually hit. The scenario the router
 * landed on is stamped onto the request so the pipeline can shape its
 * log lines. Per-scenario `rules[]` predicated overrides run inside
 * selectModel and produce the fallback chain the failover paths walk.
 *
 * @deprecated Scheduled for removal after `ROUTER_MODE=quota-aware`
 * reaches 100% rollout for a full release cycle. Migrate to the
 * preference-based selector: set `ROUTER_MODE=quota-aware` and
 * configure the chain via `/router-preferences`. See
 * docs/plan/quota-aware-router-post-phase-4.md §Phase 8 for the
 * staged deletion timeline (planned v3.0.0).
 *
 * Port of vendor utils/router.ts, tightened to strict types: the
 * request body is now `RouterRequestBody` and the router config is
 * `RouterConfig` (mirrors AppConfig.Router from src/schemas).
 *
 * This file wires the pieces together; the pieces themselves live under
 * `./scenario-router/`: shared types, proactive failover, the
 * `selectModel` heuristics, persona/system-prompt injection, and the
 * per-session/per-project Router override lookup.
 */

import type { FlatRouter } from '@/schemas'
import { isSessionInRollout } from '../services/routing-scheduler/rollout'
import { logShadowDivergence, resolveQuotaAwareSelection } from './quota-router/runtime'
import { applyProactiveFailover } from './scenario-router/failover'
import { selectModel } from './scenario-router/model-selection'
import { applyGlobalSystemPrompt, resolveActivePersonaPrompt } from './scenario-router/persona'
import { getProjectRouter } from './scenario-router/project-config'
import type { RouterConfig, RouterContext, RouterRequest, RouterRequestBody } from './scenario-router/types'
import type { TokenizeRequest } from './tokenizers/base'

// Read the runtime mode + rollout knobs from process.env once per
// routeScenario call. The values are safe to re-read every request
// because applyUiConfig writes them via applyEnvelopeToEnv (a hot
// reload without a server restart already updates process.env).
const readRouterMode = (): 'scenario' | 'preference' | 'quota-aware' => {
  const raw = process.env.ROUTER_MODE ?? 'scenario'
  return raw === 'preference' || raw === 'quota-aware' ? raw : 'scenario'
}
const readRouterShadow = (): 'off' | 'preference' | 'quota-aware' => {
  const raw = process.env.ROUTER_SHADOW ?? 'off'
  return raw === 'preference' || raw === 'quota-aware' ? raw : 'off'
}
const readRolloutPct = (): number => {
  const raw = Number.parseInt(process.env.ROUTER_ROLLOUT_PCT ?? '100', 10)
  if (!Number.isFinite(raw)) return 100
  if (raw < 0) return 0
  if (raw > 100) return 100
  return raw
}

export type { ScenarioRouterConfig as RouterConfig, ScenarioType } from '@/schemas'
export type { SubscriptionKindProvider } from './scenario-router/failover'
export { applyProactiveFailover, candidateUsable, subscriptionKindOf } from './scenario-router/failover'
export type { EffortLevel, ModelTier } from './scenario-router/model-selection'
export { isHeavyRequest, selectModel } from './scenario-router/model-selection'
export type { RouterContext, RouterRequest, RouterRequestBody } from './scenario-router/types'

/**
 * Mutates `req.body.model` to the selected target model and stamps
 * `req.scenarioType`. Errors fall back to `Router.default` so the
 * router never aborts the pipeline.
 */
export async function routeScenario(req: RouterRequest, ctx: RouterContext): Promise<void> {
  // metadata.user_id may carry "<user>_session_<id>" — strip the session
  // out so project-specific config can pick the matching profile.
  const userId = req.body.metadata?.user_id
  if (userId) {
    const parts = userId.split('_session_')
    if (parts.length > 1) req.sessionId = parts[1]
  }

  // Bypass for OpenAI-compat inbound: /v1/chat/completions and
  // /v1/responses callers hand-pick their target with `provider,model`
  // in body.model and expect that exact model to reach upstream — the
  // scenario map, per-project overrides, rule stack, and quota-aware
  // selector are all Anthropic-idiom conveniences that would silently
  // rewrite the caller's choice. Skip the whole selector, leave
  // body.model as-is, and stamp default-scenario metadata so the
  // downstream pipeline has the fields it reads.
  if (req.inboundPath === '/v1/chat/completions' || req.inboundPath === '/v1/responses') {
    req.scenarioType = 'default'
    req.isSubagent = false
    req.resolvedFallbacks = []
    return
  }

  try {
    const tokenCount = await countRequestTokens(ctx.tokenizers, req.body)
    req.tokenCount = tokenCount

    const project = await getProjectRouter(req)
    const globalRouter = ctx.config.get<RouterConfig>('Router')
    // Project-level override wins; fall through to the global Router map
    // when no per-project file applies.
    const router: RouterConfig | undefined = project !== undefined ? project : globalRouter

    const scenarioResult = selectModel(req, tokenCount, router, ctx.config)
    const mode = readRouterMode()
    const shadow = readRouterShadow()
    const inRollout = isSessionInRollout(req.sessionId ?? null, readRolloutPct())

    // Quota-aware primary path: only when the mode is set AND the
    // session falls into the rollout bucket. Outside the bucket
    // (or when preferences resolve to nothing) we fall back to the
    // scenario router's output so behaviour degrades gracefully.
    let model = scenarioResult.model
    let fallbacks: string[] = scenarioResult.fallbacks
    if (mode === 'quota-aware' && inRollout) {
      const requestedModel = typeof req.body.model === 'string' ? req.body.model : undefined
      const quotaAware = await resolveQuotaAwareSelection({
        requestedModel,
        isSubagent: scenarioResult.isSubagent,
        scenario: scenarioResult.scenarioType,
        requestTokenCount: tokenCount
      })
      if (quotaAware.selection.primary !== null) {
        model = quotaAware.selection.primary
        fallbacks = quotaAware.selection.fallbacks
      } else if (quotaAware.retryAfterSec !== null) {
        // Phase 4: all preference candidates were gated out AND the
        // profile's `exhaustedBehavior` implied a 429 (the selector
        // returns a non-null retryAfterSec only in that case). Stamp
        // the seconds on the request so the /v1 handler can reply
        // with a rate_limit_error + Retry-After header without
        // dispatching upstream.
        req.quotaExhaustedRetryAfterSec = quotaAware.retryAfterSec
        req.log.warn(
          { retryAfterSec: quotaAware.retryAfterSec, skipped: quotaAware.selection.skipped },
          '[routing-quota-aware] preference chain exhausted — will 429'
        )
      } else {
        // Passthrough branch: no primary, no Retry-After. The
        // scenario router's answer stays in place.
        req.log.info(
          { skipped: quotaAware.selection.skipped },
          '[routing-quota-aware] no primary — falling back to scenario router'
        )
      }
    }

    // Shadow path: run the quota-aware selector alongside the primary
    // path and log divergence without affecting routing. Skipped when
    // the primary path already IS the quota-aware selector.
    if (shadow === 'quota-aware' && !(mode === 'quota-aware' && inRollout)) {
      const requestedModel = typeof req.body.model === 'string' ? req.body.model : undefined
      const quotaAware = await resolveQuotaAwareSelection({
        requestedModel,
        isSubagent: scenarioResult.isSubagent,
        scenario: scenarioResult.scenarioType,
        requestTokenCount: tokenCount
      }).catch((err) => {
        req.log.warn({ err }, '[routing-shadow] resolveQuotaAwareSelection threw — dropping shadow log')
        return null
      })
      if (quotaAware !== null) {
        logShadowDivergence({
          scenarioPrimary: model,
          shadow: quotaAware.selection,
          requestedModel,
          isSubagent: scenarioResult.isSubagent
        })
      }
    }

    req.body.model = applyProactiveFailover(
      model,
      scenarioResult.scenarioType,
      fallbacks,
      tokenCount,
      ctx.config,
      req.log
    )
    req.scenarioType = scenarioResult.scenarioType
    req.isSubagent = scenarioResult.isSubagent
    req.resolvedFallbacks = fallbacks

    // Append the active persona's prompt to user-facing routes. AFTER
    // subagent-tag handling (done inside selectModel) so it composes
    // with — rather than clobbers — any per-call system content. Empty
    // is a no-op, keeping the cached prefix byte-stable.
    //
    // Gated to Anthropic-shape inbound (/v1/messages) only: persona is
    // an Anthropic-idiom convenience the Claude Code client expects,
    // and injecting it on an OpenAI-compat caller adds a stray
    // top-level `system` field the OpenAI wire format doesn't model —
    // upstreams that strictly allow-list top-level params (codex is
    // one) then reject the whole request with 400
    // `Unsupported parameter: system`. `inboundPath` is absent on the
    // pre-existing test callers that predate this hook; treat that as
    // "unknown, apply the enrichment" for backward-compat.
    if (req.inboundPath === undefined || req.inboundPath === '/v1/messages') {
      const personaPrompt = resolveActivePersonaPrompt(router, ctx.config)
      req.body.system = applyGlobalSystemPrompt(req.body.system, personaPrompt)
    }
  } catch (err) {
    req.log.error({ err }, 'scenario router failed; falling back to default model')
    // The runtime Router is the flat shape; the default agent primary is
    // the safe fallback target when routing itself threw.
    const fallback = ctx.config.get<FlatRouter>('Router')?.agent?.default
    if (typeof fallback === 'string' && fallback.length > 0) req.body.model = fallback
    req.scenarioType = 'default'
  }
}

async function countRequestTokens(tokenizers: RouterContext['tokenizers'], body: RouterRequestBody): Promise<number> {
  const tokenize: TokenizeRequest = {
    messages: Array.isArray(body.messages) ? body.messages : [],
    system: body.system,
    tools: body.tools
  }
  const result = await tokenizers.countTokens(tokenize)
  return result.tokenCount
}
