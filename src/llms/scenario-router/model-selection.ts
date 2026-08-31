/**
 * Scenario router model-selection heuristics.
 *
 * `selectModel` decides which configured model a request lands on in three
 * stages:
 *   1. Caller kind — a <CCR-SUBAGENT-MODEL> tag's PRESENCE selects the
 *      scenario's `subagent` route; otherwise the `agent` route. The tag's
 *      model value is not used to route; the tag is stripped either way so
 *      the marker never leaks upstream.
 *   2. Scenario classification — size-based longContext, web-search,
 *      thinking→think, effort/tier escalation, else default.
 *   3. Route lookup — walk the scenario's rule stack (first predicate
 *      match wins); when no rule matches, use the scenario's catch-all
 *      primary; when that's also unset, fall back to the request's own
 *      model. The former haiku→background branch is now expressed as a
 *      predicated rule on the `default` scenario (populated by the
 *      migration `20260728_router_rules_drop_background`).
 */

// Three modules, one per stage of the doc above: `request-signals` reads
// the wire, `rules` judges a predicate against it, and this file holds
// the config lookup and the classifier that pick which of them to ask.
import type { RouteRule, ScenarioType } from '@/schemas'
import { RouteRuleSchema } from '@/schemas'
import type { ConfigStore } from '../registry/config'
import { isHeavyRequest, isThinkingEnabled, isWebSearchTool, stripSubagentTag } from './request-signals'
import { matchesRule, type RuleEvalContext } from './rules'
import type { RouterConfig, RouterRequest } from './types'

// `selectModel` is the only entry point most callers need, but the
// pieces it is built from are public API in their own right — the Rule
// Tester screen and the quota router import them directly. Re-exported
// here so `scenario-router/model-selection` stays the one import path.
export type { EffortLevel, ModelTier } from './request-signals'
export { isHeavyRequest, tierOf } from './request-signals'
export type { ConditionVerdict, RuleEvalContext } from './rules'
export { explainRule, matchesRule } from './rules'

const DEFAULT_LONG_CONTEXT_THRESHOLD = 128_000
// Fraction of the default agent primary's contextWindow used as the
// effective auto-threshold. Leaves 30% headroom for the response and
// the CCR wrapper overhead so a request landing just under the model's
// hard ceiling still fits when the reply lands. Not user-configurable
// yet — flipped to a config knob once we have signal it isn't a fit.
const LONG_CONTEXT_AUTO_RATIO = 0.7

// Resolve the effective longContext threshold from the flat runtime
// router. A configured numeric threshold wins outright; when null
// (auto) the effective value is the default agent primary's
// contextWindow scaled by LONG_CONTEXT_AUTO_RATIO; when that is also
// unresolved (no default primary, no scraped contextWindow), fall back
// to the historical DEFAULT_LONG_CONTEXT_THRESHOLD so the classifier
// never sees a NaN / 0.
export function effectiveLongContextThreshold(router: RouterConfig | undefined): number {
  const manual = router?.longContextThreshold
  if (typeof manual === 'number' && manual > 0) return manual
  const window = router?.defaultAgentContextWindow
  if (typeof window === 'number' && window > 0) return Math.floor(window * LONG_CONTEXT_AUTO_RATIO)
  return DEFAULT_LONG_CONTEXT_THRESHOLD
}

// Which route within a scenario a request uses: `agent` for normal /
// main-agent traffic, `subagent` when a <CCR-SUBAGENT-MODEL> tag is present.
export type RouteKind = 'agent' | 'subagent'

export function selectModel(
  req: RouterRequest,
  tokenCount: number,
  router: RouterConfig | undefined,
  // Kept for call-site compatibility; model selection no longer resolves
  // by the request's bare model name, so the provider registry isn't read.
  _config: ConfigStore
): { model: string; scenarioType: ScenarioType; isSubagent: boolean; fallbacks: string[] } {
  // Stage 1 — caller kind. A <CCR-SUBAGENT-MODEL> tag's PRESENCE selects
  // the subagent route; its value is ignored. The tag is stripped in place
  // regardless so the CCR-internal marker never reaches upstream.
  const isSubagent = stripSubagentTag(req.body.system)
  req.isSubagent = isSubagent
  const kind: RouteKind = isSubagent ? 'subagent' : 'agent'

  // Stage 2 — scenario classification from the request signals.
  const scenario = classifyScenario(req, tokenCount, router, kind)

  // Stage 3 — walk the scenario's rule stack first (first-match wins).
  // A matched rule overrides the catch-all primary AND supplies its own
  // fallback chain. Falls back to the request's own model when nothing
  // is configured.
  const resolved = resolveTarget(router, kind, scenario, { req, tokenCount })
  const model = resolved?.primary ?? req.body.model
  const fallbacks = resolved?.fallbacks ?? []
  return { model, scenarioType: scenario, isSubagent, fallbacks }
}

// The primary "provider,model" configured for a scenario on the chosen
// route kind, or undefined when unset. Reads the flat runtime maps
// (router.agent / router.subagent); null / empty read as unset.
function primaryFor(router: RouterConfig | undefined, kind: RouteKind, scenario: ScenarioType): string | undefined {
  const map = kind === 'subagent' ? router?.subagent : router?.agent
  const value = map?.[scenario]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// Return the ordered rule list for (scenario, kind), or an empty array
// when the runtime router doesn't carry rules (per-project override
// files may skip them entirely). The runtime shape stores rules as
// unknown[] — each entry is parsed through RouteRuleSchema here so a
// malformed rule is skipped rather than blowing up the walker.
export function rulesFor(router: RouterConfig | undefined, kind: RouteKind, scenario: ScenarioType): RouteRule[] {
  const map = kind === 'subagent' ? router?.subagentRules : router?.agentRules
  const list = map?.[scenario]
  if (!Array.isArray(list)) return []
  const out: RouteRule[] = []
  for (const item of list) {
    const parsed = RouteRuleSchema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

// Resolve the primary target for (scenario, kind, request): walk the
// scenario's rule stack; the first rule whose predicate matches wins
// and its `target` becomes the primary. The failover chain then
// cascades through the scenario catch-all: rule target → scenario
// primary → scenario fallbacks, deduped in order. Returns undefined
// when neither a matching rule nor a catch-all is configured, so
// selectModel can fall back to `req.body.model` with an empty chain.
function resolveTarget(
  router: RouterConfig | undefined,
  kind: RouteKind,
  scenario: ScenarioType,
  ctx: RuleEvalContext
): { primary: string; fallbacks: string[] } | undefined {
  const fallbacksMap = kind === 'subagent' ? router?.subagentFallbacks : router?.agentFallbacks
  const scenarioFallbacks = fallbacksMap?.[scenario]
  const catchAllFallbacks = Array.isArray(scenarioFallbacks) ? scenarioFallbacks : []
  const scenarioPrimary = primaryFor(router, kind, scenario)

  for (const rule of rulesFor(router, kind, scenario)) {
    if (!matchesRule(rule, ctx)) continue
    if (typeof rule.target === 'string' && rule.target.length > 0) {
      ctx.req.log.info({ rule: rule.name ?? '(unnamed)', scenario, kind }, 'Matched routing rule')
      // Cascade: rule target → scenario primary → catch-all fallbacks.
      // Drop the scenario primary when it equals the rule target so the
      // walker doesn't re-attempt the same model twice; buildFailoverChain
      // dedupes the remaining catch-all entries downstream.
      const cascade =
        scenarioPrimary !== undefined && scenarioPrimary !== rule.target
          ? [scenarioPrimary, ...catchAllFallbacks]
          : catchAllFallbacks
      return { primary: rule.target, fallbacks: cascade }
    }
    // Rule matched but has no target — a legitimate "block escalation"
    // pattern (e.g. "for these requests, do NOT reroute"). Return
    // undefined so selectModel falls back to `req.body.model`.
    return undefined
  }
  if (scenarioPrimary === undefined) return undefined
  return { primary: scenarioPrimary, fallbacks: catchAllFallbacks }
}

// Classify the request into a scenario. A scenario only wins when the
// chosen route has a primary configured for it — an unconfigured lane
// falls through so a heavy/haiku/etc. request without a matching route
// lands on `default` (matching the pre-refactor behaviour).
function classifyScenario(
  req: RouterRequest,
  tokenCount: number,
  router: RouterConfig | undefined,
  kind: RouteKind
): ScenarioType {
  const threshold = effectiveLongContextThreshold(router)

  // Long context by size — token count exceeds threshold.
  if (tokenCount > threshold && primaryFor(router, kind, 'longContext') !== undefined) {
    req.log.info(`Using long context model due to token count: ${tokenCount}, threshold: ${threshold}`)
    return 'longContext'
  }

  // NOTE: the pre-rules haiku→background branch is gone; the same
  // behaviour is now expressed as a predicated rule on the `default`
  // scenario (see the `20260728_router_rules_drop_background` migration).
  // Rule evaluation happens in resolveTarget after this classifier runs.

  // Web search tools — higher priority than `thinking`. body.tools may
  // carry vendor-specific shapes (Anthropic's `{ type: 'web_search_*' }`
  // block) that TokenizeTool doesn't model.
  if (
    primaryFor(router, kind, 'webSearch') !== undefined &&
    Array.isArray(req.body.tools) &&
    req.body.tools.some(isWebSearchTool)
  ) {
    return 'webSearch'
  }

  // `thinking` opts into the think lane when `type` is 'enabled'
  // (explicit budget) or 'adaptive' (model decides). Claude Code
  // sends `{type: 'disabled'}` on every non-Plan-Mode request, so a
  // boolean check on `req.body.thinking` alone silently routes cheap
  // default traffic through the expensive `think` slot (Opus in most
  // configs). isThinkingEnabled excludes 'disabled' specifically.
  if (isThinkingEnabled(req.body) && primaryFor(router, kind, 'think') !== undefined) {
    req.log.info({ thinking: req.body.thinking }, 'Using think model')
    return 'think'
  }

  // Effort/tier escalation — high effort or an opus-tier requested model
  // routes into the longContext (Opus) lane even when the request is
  // short enough to skip the size-based branch above.
  if (primaryFor(router, kind, 'longContext') !== undefined && isHeavyRequest(req.body)) {
    req.log.info({ model: req.body.model }, 'Using long context model due to heavy effort/tier signal')
    return 'longContext'
  }

  return 'default'
}
