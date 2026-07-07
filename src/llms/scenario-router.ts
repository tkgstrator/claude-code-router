/**
 * Scenario-based model routing.
 *
 * Reads the inbound request and the configured `Router` map (default /
 * background / think / longContext / webSearch) and rewrites
 * `body.model` to the model the request should actually hit. The
 * scenario the router landed on is stamped onto the request so the
 * pipeline can shape its log lines (and, historically, pick a fallback
 * model — fallback was removed when we cut handleFallback).
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

import { applyProactiveFailover } from './scenario-router/failover'
import { selectModel } from './scenario-router/model-selection'
import { applyGlobalSystemPrompt, resolveActivePersonaPrompt } from './scenario-router/persona'
import { getProjectRouter } from './scenario-router/project-config'
import type { RouterConfig, RouterContext, RouterRequest, RouterRequestBody } from './scenario-router/types'
import type { TokenizeRequest } from './tokenizers/base'

export type { ScenarioRouterConfig as RouterConfig, ScenarioType } from '@/schemas'
export type { SubscriptionKindProvider } from './scenario-router/failover'
export {
  applyProactiveFailover,
  candidateUsable,
  subscriptionKindOf,
  WEEKLY_DRAIN_MARGIN_PCT_DEFAULT
} from './scenario-router/failover'
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

  try {
    const tokenCount = await countRequestTokens(ctx.tokenizers, req.body)
    req.tokenCount = tokenCount

    const project = await getProjectRouter(req)
    const globalRouter = ctx.config.get<RouterConfig>('Router')
    // Project-level override wins; fall through to the global Router map
    // when no per-project file applies.
    const router: RouterConfig | undefined = project !== undefined ? project : globalRouter

    const { model, scenarioType } = selectModel(req, tokenCount, router, ctx.config)
    req.body.model = applyProactiveFailover(model, scenarioType, tokenCount, ctx.config, req.log)
    req.scenarioType = scenarioType

    // Append the active persona's prompt to user-facing routes only,
    // AFTER subagent-tag handling (done inside selectModel) so it
    // composes with — rather than clobbers — any per-call system content.
    // The `background` route runs lightweight internal tasks (e.g. title
    // generation) where a persona voice would corrupt the output, so it is
    // excluded. Empty is a no-op, keeping the cached prefix byte-stable.
    const personaPrompt = scenarioType === 'background' ? '' : resolveActivePersonaPrompt(router, ctx.config)
    req.body.system = applyGlobalSystemPrompt(req.body.system, personaPrompt)
  } catch (err) {
    req.log.error({ err }, 'scenario router failed; falling back to default model')
    const fallback = ctx.config.get<RouterConfig>('Router')?.default
    if (fallback) req.body.model = fallback
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
