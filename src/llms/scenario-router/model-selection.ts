/**
 * Scenario router model-selection heuristics.
 *
 * `selectModel` decides which configured model a request lands on in three
 * stages:
 *   1. Caller kind — a <CCR-SUBAGENT-MODEL> tag's PRESENCE selects the
 *      scenario's `subagent` route; otherwise the `agent` route. The tag's
 *      model value is not used to route; the tag is stripped either way so
 *      the marker never leaks upstream.
 *   2. Scenario classification — size-based longContext, haiku→background,
 *      web-search, thinking→think, effort/tier escalation, else default.
 *   3. Route lookup — the chosen route's primary, or the request's own
 *      model when that route has no primary configured.
 */

import type { ScenarioType } from '@/schemas'
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
): { model: string; scenarioType: ScenarioType; isSubagent: boolean } {
  // Stage 1 — caller kind. A <CCR-SUBAGENT-MODEL> tag's PRESENCE selects
  // the subagent route; its value is ignored. The tag is stripped in place
  // regardless so the CCR-internal marker never reaches upstream.
  const isSubagent = stripSubagentTag(req.body.system)
  req.isSubagent = isSubagent
  const kind: RouteKind = isSubagent ? 'subagent' : 'agent'

  // Stage 2 — scenario classification from the request signals.
  const scenario = classifyScenario(req, tokenCount, router, kind)

  // Stage 3 — the chosen route's primary, falling back to the request's
  // own model when that route has no primary configured.
  const primary = primaryFor(router, kind, scenario)
  const model = primary !== undefined ? primary : req.body.model
  return { model, scenarioType: scenario, isSubagent }
}

// The primary "provider,model" configured for a scenario on the chosen
// route kind, or undefined when unset. Reads the flat runtime maps
// (router.agent / router.subagent); null / empty read as unset.
function primaryFor(router: RouterConfig | undefined, kind: RouteKind, scenario: ScenarioType): string | undefined {
  const map = kind === 'subagent' ? router?.subagent : router?.agent
  const value = map?.[scenario]
  return typeof value === 'string' && value.length > 0 ? value : undefined
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

  // Any Claude Haiku variant → background.
  if (isHaiku(req.body.model) && primaryFor(router, kind, 'background') !== undefined) {
    req.log.info(`Using background model for ${req.body.model}`)
    return 'background'
  }

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

function isHaiku(model: string): boolean {
  return typeof model === 'string' && model.includes('claude') && model.includes('haiku')
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
