/**
 * Scenario router model-selection heuristics.
 *
 * `selectModel` decides which configured model a request lands on:
 * bare-model-name match, size-based longContext, `<CCR-SUBAGENT-MODEL>`
 * tag, haiku->background, web-search, thinking->think, and finally the
 * heavy-effort/tier escalation. Each branch is its own small function so
 * `selectModel` reads as a priority list.
 */

import type { ScenarioType } from '@/schemas'
import type { ConfigStore } from '../registry/config'
import {
  type ConfigProvider,
  isProviderRegistrable,
  type RouterConfig,
  type RouterRequest,
  type RouterRequestBody
} from './types'

const DEFAULT_LONG_CONTEXT_THRESHOLD = 60_000

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
// selectModel and would double-count if we mixed them in.
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
  config: ConfigStore
): { model: string; scenarioType: ScenarioType } {
  // Bare model-name override — when the request's `model` string is a
  // model name that some configured provider already hosts, honor that
  // choice as-is. This sits ABOVE the heuristic rewrites (haiku →
  // background, opus → longContext, thinking → think) so a client that
  // explicitly asks for `claude-haiku-4-5` lands on the matching
  // provider rather than whatever the background slot points at.
  // Falls through silently when no provider hosts the name, so the
  // existing scenario routing remains the catch-all.
  const direct = resolveByModelName(req.body.model, config)
  if (direct) {
    req.log.info({ model: direct.model }, 'Using request-specified model — exact provider match')
    return direct
  }

  // Long context — token count exceeds threshold AND Router.longContext set.
  if (router) {
    const longContext = pickLongContext(req, tokenCount, router)
    if (longContext) return longContext
  }

  // <CCR-SUBAGENT-MODEL> tag in the second system block — explicit
  // per-call model override Claude Code's subagent flow uses.
  const subagentModel = extractSubagentModel(req.body.system)
  if (subagentModel) return { model: subagentModel, scenarioType: 'default' }

  // Any Claude Haiku variant → background model.
  if (isHaikuBackground(req.body.model, router)) {
    req.log.info(`Using background model for ${req.body.model}`)
    return { model: router.background, scenarioType: 'background' }
  }

  // Web search tools — higher priority than `thinking`. body.tools may
  // carry vendor-specific shapes (Anthropic's `{ type: 'web_search_*' }`
  // block) that TokenizeTool doesn't model.
  if (router?.webSearch && Array.isArray(req.body.tools) && req.body.tools.some(isWebSearchTool)) {
    return { model: router.webSearch, scenarioType: 'webSearch' }
  }

  // `thinking` field present → think model.
  if (req.body.thinking && router?.think) {
    req.log.info({ thinking: req.body.thinking }, 'Using think model')
    return { model: router.think, scenarioType: 'think' }
  }

  // Effort/tier escalation — high effort or an opus-tier requested model
  // routes into the longContext (Opus) lane even when the request is
  // short enough to skip the size-based pickLongContext above.
  if (router?.longContext && isHeavyRequest(req.body)) {
    req.log.info({ model: req.body.model }, 'Using long context model due to heavy effort/tier signal')
    return { model: router.longContext, scenarioType: 'longContext' }
  }

  const fallback = router?.default
  return { model: fallback ? fallback : req.body.model, scenarioType: 'default' }
}

// Look for the first provider whose registered `models` list contains
// the bare model name. Returns the canonical `provider,model` pair so
// the rest of the pipeline can resolve it. Case-insensitive. Returns
// null when no provider hosts the name — caller falls through to
// scenario routing.
function resolveByModelName(
  rawModel: string,
  config: ConfigStore
): { model: string; scenarioType: ScenarioType } | null {
  const providers = config.get<ConfigProvider[]>('providers', [])
  // Prefer subscription providers over api_key when both host the same
  // model. Subscription is the user's primary "free" capacity (they
  // already paid the seat); api_key burns per-token spend. Without this
  // bias, a bare `claude-opus-4-8` request can land on a half-configured
  // anthropic api_key provider while a healthy claude-code subscription
  // hosts the same model.
  const subscriptionFirst = [
    ...providers.filter((p) => p.auth_mode === 'subscription'),
    ...providers.filter((p) => p.auth_mode !== 'subscription')
  ]
  for (const p of subscriptionFirst) {
    if (!p.models) continue
    // Skip providers the ProviderRegistry would reject (missing api_key
    // etc.) — picking them here just bait the chain walker into a dead
    // "provider not found; skipping" hop.
    if (!isProviderRegistrable(p)) continue
    const match = p.models.find((m) => m.toLowerCase() === rawModel.toLowerCase())
    if (match) return { model: `${p.name},${match}`, scenarioType: 'default' }
  }
  return null
}

function pickLongContext(
  req: RouterRequest,
  tokenCount: number,
  router: RouterConfig
): { model: string; scenarioType: ScenarioType } | undefined {
  const threshold =
    typeof router.longContextThreshold === 'number' ? router.longContextThreshold : DEFAULT_LONG_CONTEXT_THRESHOLD
  if (tokenCount > threshold && router.longContext) {
    req.log.info(`Using long context model due to token count: ${tokenCount}, threshold: ${threshold}`)
    return { model: router.longContext, scenarioType: 'longContext' }
  }
  return undefined
}

function isHaikuBackground(
  model: string,
  router: RouterConfig | undefined
): router is RouterConfig & { background: string } {
  return (
    typeof model === 'string' &&
    model.includes('claude') &&
    model.includes('haiku') &&
    typeof router?.background === 'string' &&
    router.background.length > 0
  )
}

function isWebSearchTool(tool: unknown): tool is { type: string } {
  if (tool === null || typeof tool !== 'object' || !('type' in tool)) return false
  const type: unknown = Reflect.get(tool, 'type')
  return typeof type === 'string' && type.startsWith('web_search')
}

function extractSubagentModel(system: RouterRequestBody['system']): string | undefined {
  if (!Array.isArray(system) || system.length < 2) return undefined
  const block = system[1]
  const text = typeof block?.text === 'string' ? block.text : undefined
  if (!text?.startsWith('<CCR-SUBAGENT-MODEL>')) return undefined
  const match = text.match(/<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s)
  if (!match) return undefined
  // Strip the tag so it doesn't reach the upstream provider.
  block.text = text.replace(`<CCR-SUBAGENT-MODEL>${match[1]}</CCR-SUBAGENT-MODEL>`, '')
  return match[1]
}
