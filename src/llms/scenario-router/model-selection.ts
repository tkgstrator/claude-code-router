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

// Which route within a scenario a request uses: `agent` for normal /
// main-agent traffic, `subagent` when a <CCR-SUBAGENT-MODEL> tag is present.
type RouteKind = 'agent' | 'subagent'

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
function rulesFor(router: RouterConfig | undefined, kind: RouteKind, scenario: ScenarioType): RouteRule[] {
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
interface RuleEvalContext {
  req: RouterRequest
  tokenCount: number
}

// Resolve the primary target for (scenario, kind, request): walk the
// scenario's rule stack; the first rule whose predicate matches wins
// and returns its `{primary, fallbacks}` pair. When no rule matches,
// fall through to the scenario's catch-all `primary` (the FK-backed
// column) + catch-all fallback chain. Returns undefined when neither a
// matching rule nor a catch-all is configured, so selectModel can fall
// back to `req.body.model` with an empty fallback chain.
function resolveTarget(
  router: RouterConfig | undefined,
  kind: RouteKind,
  scenario: ScenarioType,
  ctx: RuleEvalContext
): { primary: string; fallbacks: string[] } | undefined {
  for (const rule of rulesFor(router, kind, scenario)) {
    if (!matchesRule(rule, ctx)) continue
    if (typeof rule.primary === 'string' && rule.primary.length > 0) {
      ctx.req.log.info({ rule: rule.name ?? '(unnamed)', scenario, kind }, 'Matched routing rule')
      return { primary: rule.primary, fallbacks: rule.fallbacks }
    }
    // Rule matched but has no primary — a legitimate "block escalation"
    // pattern (e.g. "for these requests, do NOT reroute"). Return
    // undefined so selectModel falls back to req.body.model.
    return undefined
  }
  const primary = primaryFor(router, kind, scenario)
  if (primary === undefined) return undefined
  const fallbacksMap = kind === 'subagent' ? router?.subagentFallbacks : router?.agentFallbacks
  const fallbacks = fallbacksMap?.[scenario]
  return { primary, fallbacks: Array.isArray(fallbacks) ? fallbacks : [] }
}

// Evaluate a rule's predicate against the request context. An empty
// predicate matches everything (catch-all rule). Missing fields on
// the predicate are unconstrained; each populated field is an AND
// with the others.
function matchesRule(rule: RouteRule, ctx: RuleEvalContext): boolean {
  const when = rule.when
  const { req, tokenCount } = ctx
  if (when.requestedTier !== undefined) {
    const tier = tierOf(req.body.model)
    if (tier === undefined || !when.requestedTier.includes(tier)) return false
  }
  if (when.requestedModel !== undefined && !globMatch(when.requestedModel, req.body.model)) return false
  if (when.thinking !== undefined && Boolean(req.body.thinking) !== when.thinking) return false
  if (when.minTokens !== undefined && tokenCount < when.minTokens) return false
  if (when.maxTokens !== undefined && tokenCount > when.maxTokens) return false
  if (when.hasTool !== undefined && !hasMatchingTool(req.body.tools, when.hasTool)) return false
  if (when.effort !== undefined) {
    const effort = readEffort(req.body)
    if (effort === undefined || !when.effort.includes(effort)) return false
  }
  return true
}

// Bucket a model string into one of the four CC families. Case-
// insensitive substring match: `claude-opus-4-7` → 'opus', `gpt-5` →
// undefined. Order matters — `fable` is checked before `opus` because
// a hypothetical `claude-fable-opus-mix` string should still tier to
// fable (the family the user explicitly asked for).
function tierOf(model: string): RequestedModelTier | undefined {
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
  const threshold =
    typeof router?.longContextThreshold === 'number' ? router.longContextThreshold : DEFAULT_LONG_CONTEXT_THRESHOLD

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

  // `thinking` field present → think model.
  if (req.body.thinking && primaryFor(router, kind, 'think') !== undefined) {
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
