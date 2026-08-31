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

import type { RequestedModelTier, RouteRule, ScenarioType } from '@/schemas'
import { RouteRuleSchema } from '@/schemas'
import type { ConfigStore } from '../registry/config'
import type { RouterConfig, RouterRequest, RouterRequestBody } from './types'

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

// Whether the request opts INTO extended thinking. Anthropic's
// `thinking` field carries a `type` discriminator with three real
// values observed in Claude Code traffic:
//   - 'enabled'  → explicit budget request (older builds, haiku)
//   - 'adaptive' → newer builds (opus 4-7, sonnet 4-6) explicitly
//                  choose adaptive so the model decides at runtime
//                  whether (and how much) to think. Distinct from
//                  omitting the field entirely: an absent `thinking`
//                  falls back to adaptive on Anthropic's side but
//                  isn't an explicit client-intent signal.
//   - 'disabled' → the caller explicitly opted OUT of thinking
// The router treats `thinking` as a client-intent signal: the field
// being present with a non-disabled discriminator means the client
// asked to be routed as a thinking request. Omitting the field is
// NOT an opt-in even though Anthropic will still run adaptive server-
// side — cheap default traffic (Bash judger, tool calls, cache reads)
// omits the field and must land on the default lane. Boolean-truthy
// on the object routes 'disabled' to the think lane (wrong — Claude
// Code sends 'disabled' on every non-Plan-Mode request, silently
// redirecting cheap default traffic onto the expensive think slot).
// Checking `type !== 'disabled'` matches the pre-fix routing for
// 'enabled'/'adaptive' while excluding 'disabled'. A field that
// isn't an object at all (or a discriminator that isn't a string)
// is treated as "not thinking" — same as the boolean check for
// those shapes.
function isThinkingEnabled(body: RouterRequestBody): boolean {
  const t = body.thinking
  if (t === null || typeof t !== 'object') return false
  const type: unknown = Reflect.get(t, 'type')
  if (typeof type !== 'string') return false
  return type !== 'disabled'
}

// Effort levels Claude Code sends in `output_config.effort`. The router
// reads this as a "how heavy is this work" hint to bias toward the
// Sonnet (default) lane for light traffic and escalate to the longContext
// (Opus) lane for heavy traffic. Per the Phase 6 plan an explicit
// low/medium suppresses the tier-based opus escalation so callers can
// override Claude Code's default model when the work is genuinely light.
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

function readEffort(body: RouterRequestBody): EffortLevel | undefined {
  const cfg = body.output_config
  if (cfg === null || typeof cfg !== 'object') return undefined
  const eff: unknown = Reflect.get(cfg, 'effort')
  if (typeof eff !== 'string') return undefined
  if (eff === 'low' || eff === 'medium' || eff === 'high' || eff === 'xhigh' || eff === 'max') return eff
  return undefined
}

export type ModelTier = 'opus' | 'sonnet' | 'haiku'

function classifyModelTier(model: string): ModelTier | undefined {
  if (typeof model !== 'string') return undefined
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return undefined
}

// Whether the request looks heavy enough to land in the Opus / long
// lane. Reads two signals in priority order:
//
//   1. `output_config.effort` — high/xhigh/max → heavy; low/medium →
//      explicitly light (suppresses the tier fallback so callers can
//      downgrade an opus request).
//   2. requested model tier — opus → heavy. Used only when effort is
//      absent so older Claude Code traffic still grades correctly.
//
// thinking presence and message size are NOT consulted here — they are
// already routed by the `think` / `longContext`-by-threshold lanes in
// classifyScenario and would double-count if we mixed them in.
export function isHeavyRequest(body: RouterRequestBody): boolean {
  const effort = readEffort(body)
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return true
  if (effort === 'low' || effort === 'medium') return false
  return classifyModelTier(body.model) === 'opus'
}

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

// Context available to predicate evaluation. All rule predicates read
// through this shape so adding a new predicate never has to thread a
// new argument through selectModel's call sites.
export interface RuleEvalContext {
  req: RouterRequest
  tokenCount: number
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

/** One predicate field's verdict, with the value it was judged against. */
export interface ConditionVerdict {
  field: 'requestedTier' | 'requestedModel' | 'thinking' | 'minTokens' | 'maxTokens' | 'hasTool' | 'effort'
  expected: string
  /** What the request actually presented. Null when it presented nothing. */
  actual: string | null
  matched: boolean
}

const show = (value: unknown): string => (Array.isArray(value) ? value.join(', ') : String(value))

/**
 * Evaluate a rule's predicate and report each populated field separately.
 *
 * An empty predicate matches everything (catch-all rule). Absent fields
 * are unconstrained; each populated field is an AND with the others —
 * which is precisely why a per-field verdict is worth having. "This rule
 * did not match" leaves the operator to guess which of five conditions
 * was responsible.
 *
 * `matchesRule` is defined in terms of this, so the tester and the
 * router cannot disagree about a rule: there is only one implementation.
 */
export function explainRule(
  rule: RouteRule,
  ctx: RuleEvalContext
): { matched: boolean; conditions: ConditionVerdict[] } {
  const when = rule.when
  const { req, tokenCount } = ctx
  const conditions: ConditionVerdict[] = []

  if (when.requestedTier !== undefined) {
    const tier = tierOf(req.body.model)
    conditions.push({
      field: 'requestedTier',
      expected: show(when.requestedTier),
      actual: tier === undefined ? null : tier,
      matched: tier !== undefined && when.requestedTier.includes(tier)
    })
  }
  if (when.requestedModel !== undefined) {
    conditions.push({
      field: 'requestedModel',
      expected: when.requestedModel,
      actual: req.body.model,
      matched: globMatch(when.requestedModel, req.body.model)
    })
  }
  if (when.thinking !== undefined) {
    const thinking = isThinkingEnabled(req.body)
    conditions.push({
      field: 'thinking',
      expected: show(when.thinking),
      actual: show(thinking),
      matched: thinking === when.thinking
    })
  }
  if (when.minTokens !== undefined) {
    conditions.push({
      field: 'minTokens',
      expected: `>= ${when.minTokens}`,
      actual: String(tokenCount),
      matched: tokenCount >= when.minTokens
    })
  }
  if (when.maxTokens !== undefined) {
    conditions.push({
      field: 'maxTokens',
      expected: `<= ${when.maxTokens}`,
      actual: String(tokenCount),
      matched: tokenCount <= when.maxTokens
    })
  }
  if (when.hasTool !== undefined) {
    conditions.push({
      field: 'hasTool',
      expected: when.hasTool,
      actual: toolTypes(req.body.tools),
      matched: hasMatchingTool(req.body.tools, when.hasTool)
    })
  }
  if (when.effort !== undefined) {
    const effort = readEffort(req.body)
    conditions.push({
      field: 'effort',
      expected: show(when.effort),
      actual: effort === undefined ? null : effort,
      matched: effort !== undefined && when.effort.includes(effort)
    })
  }

  return { matched: conditions.every((c) => c.matched), conditions }
}

export function matchesRule(rule: RouteRule, ctx: RuleEvalContext): boolean {
  return explainRule(rule, ctx).matched
}

// The tool types the request actually carried, for the hasTool verdict —
// "no tool matched `web_*`" is only actionable alongside what was there.
function toolTypes(tools: unknown): string | null {
  if (!Array.isArray(tools)) return null
  const types = tools
    .map((tool) => (tool !== null && typeof tool === 'object' ? Reflect.get(tool, 'type') : undefined))
    .filter((t): t is string => typeof t === 'string')
  return types.length === 0 ? null : types.join(', ')
}

// Bucket a model string into one of the four CC families. Case-
// insensitive substring match: `claude-opus-4-7` → 'opus', `gpt-5` →
// undefined. Order matters — `fable` is checked before `opus` because
// a hypothetical `claude-fable-opus-mix` string should still tier to
// fable (the family the user explicitly asked for).
export function tierOf(model: string): RequestedModelTier | undefined {
  if (typeof model !== 'string') return undefined
  const lower = model.toLowerCase()
  if (lower.includes('fable')) return 'fable'
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return undefined
}

function hasMatchingTool(tools: unknown, pattern: string): boolean {
  if (!Array.isArray(tools)) return false
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object') continue
    const type: unknown = Reflect.get(tool, 'type')
    if (typeof type === 'string' && globMatch(pattern, type)) return true
  }
  return false
}

// Match a shell-style glob against a string. `*` = any run of chars
// (including empty); every other char is literal. Anchored to the full
// input on both ends (so `*haiku*` matches "claude-haiku-4-5" but
// `haiku` does not — matching a raw substring would require the user
// to write `*haiku*`).
function globMatch(pattern: string, value: string): boolean {
  if (typeof value !== 'string') return false
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
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

function isWebSearchTool(tool: unknown): tool is { type: string } {
  if (tool === null || typeof tool !== 'object' || !('type' in tool)) return false
  const type: unknown = Reflect.get(tool, 'type')
  return typeof type === 'string' && type.startsWith('web_search')
}

// Detect a <CCR-SUBAGENT-MODEL> tag in the second system block and strip
// it in place so the CCR-internal marker never leaks upstream. Returns
// true when the tag is present — its PRESENCE selects the subagent route;
// its VALUE is not used for routing. Only a well-formed (closed) tag is
// stripped, matching the old extractSubagentModel behaviour; a malformed
// (unclosed) tag still counts as present but is left untouched.
function stripSubagentTag(system: RouterRequestBody['system']): boolean {
  if (!Array.isArray(system) || system.length < 2) return false
  const block = system[1]
  const text = typeof block?.text === 'string' ? block.text : undefined
  if (text?.startsWith('<CCR-SUBAGENT-MODEL>') !== true) return false
  const match = text.match(/<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s)
  if (match) {
    block.text = text.replace(`<CCR-SUBAGENT-MODEL>${match[1]}</CCR-SUBAGENT-MODEL>`, '')
  }
  return true
}
