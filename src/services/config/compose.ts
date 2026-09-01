/**
 * Read-side composition: join the on-disk envelope with the DB-resident
 * Providers / Router tables into the `AppConfig` shape consumed by the
 * API / UI.
 */

import type { AppConfig } from '@/schemas/api/config'
import { type Provider, type RouteRule, RouteRuleSchema, type Router } from '@/schemas/domain'
import type { ConfigEnvelope, ScenarioKey } from '@/shared'
import { getPrismaClient } from '../../db/client'
import {
  type ApiStyle,
  AuthMode,
  type Model as DbModel,
  type Provider as DbProvider,
  ModelTestStatus
} from '../../generated/prisma/client'
import { readConfigFile } from './envelope'
import { isJsonObject } from './transformer'

// A fresh, unassigned route target: no primary, empty fallback chain, no
// rules. Rules default to [] so a slot with no advanced routing is
// indistinguishable from the pre-rules shape on the wire.
const emptyRoute = (): { primary: null; fallbacks: []; rules: [] } => ({
  primary: null,
  fallbacks: [],
  rules: []
})

// Every scenario starts unassigned: both the agent and subagent routes
// have a null primary (not '' — "no model bound" reads the same on the
// wire as everywhere else) and an empty fallback chain, so composeUiConfig
// can fill each route in place without a guard. Scenario-scoped knobs sit
// on their owning scenario (currently only threshold on longContext) at
// their policy defaults.
export const emptyRouter = (): Router => ({
  default: { agent: emptyRoute(), subagent: emptyRoute() },
  think: { agent: emptyRoute(), subagent: emptyRoute() },
  longContext: { agent: emptyRoute(), subagent: emptyRoute(), threshold: null },
  webSearch: { agent: emptyRoute(), subagent: emptyRoute() },
  image: { agent: emptyRoute(), subagent: emptyRoute() },
  persona: null
})

export const formatSlot = (
  provider: DbProvider | null | undefined,
  model: DbModel | null | undefined
): string | null => (provider && model ? `${provider.name},${model.name}` : null)

// Read `threshold` off a routerSlot.params JSON column without casting.
export const thresholdFromParams = (params: unknown): number | null => {
  if (!isJsonObject(params)) return null
  const t = params.threshold
  return typeof t === 'number' ? t : null
}

// Read a named ordered "provider,model" list off a routerSlot.params JSON
// column. Returns the strings in order, or null when the key is absent /
// empty (so callers can skip the assignment entirely).
const stringListFromParams = (params: unknown, key: 'fallbacks' | 'subagentFallbacks'): string[] | null => {
  if (!isJsonObject(params)) return null
  const raw = params[key]
  if (!Array.isArray(raw)) return null
  const list = raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return list.length > 0 ? list : null
}

// Agent-route fallback chain (the existing `fallbacks` key, reused).
export const fallbacksFromParams = (params: unknown): string[] | null => stringListFromParams(params, 'fallbacks')

// Subagent-route fallback chain (`subagentFallbacks`).
export const subagentFallbacksFromParams = (params: unknown): string[] | null =>
  stringListFromParams(params, 'subagentFallbacks')

// Read a rules list off a routerSlot.params JSON column. Any entry
// failing schema validation is skipped rather than aborting the whole
// slot — a malformed rule shouldn't take the router offline. Returns []
// when the key is absent or fully invalid.
const rulesFromParams = (params: unknown, key: 'agentRules' | 'subagentRules'): RouteRule[] => {
  if (!isJsonObject(params)) return []
  const raw = params[key]
  if (!Array.isArray(raw)) return []
  const out: RouteRule[] = []
  for (const item of raw) {
    const parsed = RouteRuleSchema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export const agentRulesFromParams = (params: unknown): RouteRule[] => rulesFromParams(params, 'agentRules')
export const subagentRulesFromParams = (params: unknown): RouteRule[] => rulesFromParams(params, 'subagentRules')

export type ProviderWithModels = DbProvider & {
  models: DbModel[]
  subscriptionAccounts?: { id: string; enabled: boolean }[]
}

/**
 * The `transformer` blob as the UI sees it.
 *
 * There is no stored blob any more — `Provider.transformer` was dropped
 * when `providerEnabled` became `Provider.enabled`. What is left is a
 * pure projection of `Model.enabled` that the provider editor and
 * ModelsDashboard still read under its old name, so the wire shape is
 * unchanged for the screens. Undefined when nothing is disabled, so a
 * fully enabled provider sends no key at all.
 */
const toWireTransformer = (disabledModels: string[]): Record<string, unknown> | undefined =>
  disabledModels.length === 0 ? undefined : { _disabledModels: disabledModels }

export const toProvider = (p: ProviderWithModels): Provider => {
  const deprecatedModels = p.models.filter((m) => m.deprecated).map((m) => m.name)
  // Model.enabled is the source of truth. Synthesize the
  // transformer._disabledModels view that the provider editor /
  // ModelsDashboard read so the UI sees the DB state directly.
  const disabledModels = p.models.filter((m) => !m.enabled).map((m) => m.name)
  const transformerOut = toWireTransformer(disabledModels)
  const tested = p.models.filter((m) => m.testStatus !== ModelTestStatus.unknown)
  const modelTestStatus: Record<string, { status: 'unknown' | 'ok' | 'fail'; passedAt: string | null }> =
    Object.fromEntries(
      tested.map((m) => [
        m.name,
        {
          // Prisma's enum value is the union we want verbatim — convert
          // through the enum reverse map rather than asserting the
          // literal type.
          status: m.testStatus,
          passedAt: m.testPassedAt ? m.testPassedAt.toISOString() : null
        }
      ])
    )
  const withContext = p.models.filter((m): m is DbModel & { contextWindow: number } => m.contextWindow !== null)
  const modelContextWindows = Object.fromEntries(withContext.map((m) => [m.name, m.contextWindow]))
  // Expose DB-held prices (scraped or backfilled from llm-prices.json) so
  // the dashboard can read prices without any frontend static fallback.
  const withPrice = p.models.filter((m) => m.inputPer1M !== null || m.outputPer1M !== null)
  const modelPrices = Object.fromEntries(
    withPrice.map((m) => [m.name, { inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M }])
  )
  const withManualTier = p.models.filter(
    (m): m is DbModel & { manualTier: 'fable' | 'opus' | 'sonnet' | 'haiku' } =>
      m.manualTier === 'fable' || m.manualTier === 'opus' || m.manualTier === 'sonnet' || m.manualTier === 'haiku'
  )
  const modelManualTiers = Object.fromEntries(withManualTier.map((m) => [m.name, m.manualTier]))
  const withApiStyle = p.models.filter((m): m is DbModel & { apiStyle: ApiStyle } => m.apiStyle !== null)
  const modelApiStyles = Object.fromEntries(withApiStyle.map((m) => [m.name, m.apiStyle]))
  const withReasoningEffort = p.models.filter(
    (m): m is DbModel & { reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' } =>
      m.reasoningEffort === 'none' ||
      m.reasoningEffort === 'minimal' ||
      m.reasoningEffort === 'low' ||
      m.reasoningEffort === 'medium' ||
      m.reasoningEffort === 'high' ||
      m.reasoningEffort === 'xhigh' ||
      m.reasoningEffort === 'max'
  )
  const modelReasoningEfforts = Object.fromEntries(withReasoningEffort.map((m) => [m.name, m.reasoningEffort]))
  return {
    name: p.name,
    enabled: p.enabled,
    api_base_url: p.apiBaseUrl,
    // DB value verbatim: null when unset. Never coerced to ''.
    api_key: p.apiKey,
    auth_mode: p.authMode,
    api_style: p.apiStyle,
    models: p.models.map((m) => m.name),
    ...(deprecatedModels.length > 0 ? { deprecatedModels } : {}),
    ...(tested.length > 0 ? { modelTestStatus } : {}),
    ...(withContext.length > 0 ? { modelContextWindows } : {}),
    ...(withPrice.length > 0 ? { modelPrices } : {}),
    ...(withManualTier.length > 0 ? { modelManualTiers } : {}),
    ...(withApiStyle.length > 0 ? { modelApiStyles } : {}),
    ...(withReasoningEffort.length > 0 ? { modelReasoningEfforts } : {}),
    // Not a stored value: _disabledModels is derived from Model.enabled
    // on every read, which is why the JSONB column it used to share with
    // `providerEnabled` could be dropped outright.
    ...(transformerOut ? { transformer: transformerOut } : {}),
    // Subscription providers expose each discovered SubAccount's
    // enable/disable state so the editor can render a switch list and
    // round-trip the user's toggles through applyUiConfig.
    ...(p.authMode === AuthMode.subscription && p.subscriptionAccounts
      ? {
          subscription_accounts: p.subscriptionAccounts.map((a) => ({
            id: a.id,
            enabled: a.enabled
          }))
        }
      : {})
  }
}

// Optional string scalars travel as null on the wire when unset (absent
// / '' on disk). Collapse a raw envelope value to that null-or-string
// shape in one place so composeUiConfig stays flat.
export const optionalScalarOrNull = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length > 0 ? raw : null

// Strip the DB-resident keys out of an on-disk envelope read so the
// composed result reflects the DB, not stale disk content.
export const stripDbKeys = (envelope: ConfigEnvelope): ConfigEnvelope => {
  const { Providers: _p, Router: _r, ...rest } = envelope
  return rest
}

export async function composeUiConfig(): Promise<AppConfig> {
  const envelope = await readConfigFile()
  const envelopeOnly = stripDbKeys(envelope)

  const prisma = getPrismaClient()
  const [providers, slots] = await Promise.all([
    prisma.provider.findMany({
      include: { models: true, subscriptionAccounts: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.routerSlot.findMany({
      include: {
        model: { include: { provider: true } },
        subagentModel: { include: { provider: true } }
      }
    })
  ])

  const router = emptyRouter()
  for (const slot of slots) {
    // slot.scenario is the Prisma ScenarioKey enum; assignable to the
    // local ScenarioKey union without a cast.
    const key: ScenarioKey = slot.scenario
    const route = router[key]
    // Agent route primary from modelId; subagent route primary from
    // subagentModelId. Each is null when the FK is unbound.
    route.agent.primary = formatSlot(slot.model?.provider, slot.model)
    route.subagent.primary = formatSlot(slot.subagentModel?.provider, slot.subagentModel)
    const agentFallbacks = fallbacksFromParams(slot.params)
    if (agentFallbacks) route.agent.fallbacks = agentFallbacks
    const subagentFallbacks = subagentFallbacksFromParams(slot.params)
    if (subagentFallbacks) route.subagent.fallbacks = subagentFallbacks
    route.agent.rules = agentRulesFromParams(slot.params)
    route.subagent.rules = subagentRulesFromParams(slot.params)
    if (key === 'longContext') {
      const threshold = thresholdFromParams(slot.params)
      if (threshold !== null) router.longContext.threshold = threshold
    }
  }

  // Fold the active persona into the composed Router from its disk-only
  // backing key (ActivePersona). Emit null when unset so the wire shows
  // "no persona" the same way the path scalars show "no value"; a present
  // name rides on Router.persona. The persona library stays top-level.
  router.persona = optionalScalarOrNull(envelopeOnly.ActivePersona)

  // Drop the disk-only persona backing key so it never leaks onto the
  // wire as a top-level field — it surfaces solely as Router.persona.
  const { ActivePersona: _activePersona, ...envelopeWithoutPersona } = envelopeOnly

  // Optional path/url scalars: emit null when absent / '' on disk so
  // the JSON editor / wire shows "no value" consistently.
  return {
    ...envelopeWithoutPersona,
    CLAUDE_PATH: optionalScalarOrNull(envelopeOnly.CLAUDE_PATH),
    PROXY_URL: optionalScalarOrNull(envelopeOnly.PROXY_URL),
    CUSTOM_ROUTER_PATH: optionalScalarOrNull(envelopeOnly.CUSTOM_ROUTER_PATH),
    Personas: envelopeOnly.Personas,
    Providers: providers.map(toProvider),
    Router: router
  }
}

export async function loadFullConfig(): Promise<AppConfig> {
  return composeUiConfig()
}
