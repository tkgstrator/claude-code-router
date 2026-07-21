/**
 * Read-side composition: join the on-disk envelope with the DB-resident
 * Providers / Router tables into the `AppConfig` shape consumed by the
 * API / UI.
 */

import type { AppConfig, Provider, Router } from '@/schemas'
import { emptyFallbacks } from '@/schemas'
import type { ConfigEnvelope, ScenarioKey } from '@/shared'
import { getPrismaClient } from '../../db/client'
import {
  AuthMode,
  type Model as DbModel,
  type Provider as DbProvider,
  ModelTestStatus
} from '../../generated/prisma/client'
import { readConfigFile } from './envelope'
import { isJsonObject, providerEnabledFromTransformer } from './transformer'

// Unassigned slots are null (not '') so "no model bound" reads the
// same on the wire as everywhere else. fallbacks starts as all-empty
// lists so composeUiConfig can assign per-scenario without a guard.
export const emptyRouter = (): Router => ({
  default: null,
  background: null,
  think: null,
  longContext: null,
  webSearch: null,
  image: null,
  fallbacks: emptyFallbacks(),
  force: {},
  longContextThreshold: 60_000,
  weeklyDrainMarginPct: 0
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

// Read the ordered `fallbacks` list off a routerSlot.params JSON column.
// Returns the "provider,model" strings in order, or null when none are
// configured (so callers can skip the assignment entirely).
export const fallbacksFromParams = (params: unknown): string[] | null => {
  if (!isJsonObject(params)) return null
  const raw = params.fallbacks
  if (!Array.isArray(raw)) return null
  const list = raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return list.length > 0 ? list : null
}

// Read the `force` flag off a routerSlot.params JSON column. True only
// when the slot is explicitly forced; anything else reads as false so
// composeUiConfig can skip the assignment (client model wins by default).
export const forceFromParams = (params: unknown): boolean => {
  if (!isJsonObject(params)) return false
  return params.force === true
}

// Read `weeklyDrainMarginPct` off the default slot's params JSON column.
// The margin is a Router-level policy knob (not slot-specific) but rides
// on the default slot's params for the same reason longContextThreshold
// rides on the longContext slot's params: it dodges a dedicated table /
// migration. 0 reads as null so composeUiConfig can omit the key when
// the policy is at its default (matching the threshold pattern).
export const weeklyDrainMarginPctFromParams = (params: unknown): number | null => {
  if (!isJsonObject(params)) return null
  const m = params.weeklyDrainMarginPct
  if (typeof m !== 'number') return null
  if (!Number.isInteger(m) || m < 0 || m > 100) return null
  return m > 0 ? m : null
}

export type ProviderWithModels = DbProvider & {
  models: DbModel[]
  subscriptionAccounts?: { id: string; enabled: boolean }[]
}

export const toProvider = (p: ProviderWithModels): Provider => {
  const deprecatedModels = p.models.filter((m) => m.deprecated).map((m) => m.name)
  // Model.enabled is the source of truth. Synthesize the
  // transformer._disabledModels view that the provider editor /
  // ModelsDashboard read so the UI sees the DB state directly.
  const disabledModels = p.models.filter((m) => !m.enabled).map((m) => m.name)
  const baseTransformer = isJsonObject(p.transformer) ? p.transformer : undefined
  const transformerOut: Record<string, unknown> | undefined =
    baseTransformer || disabledModels.length > 0
      ? {
          ...(baseTransformer ? baseTransformer : {}),
          ...(disabledModels.length > 0 ? { _disabledModels: disabledModels } : {})
        }
      : undefined
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
  return {
    name: p.name,
    enabled: providerEnabledFromTransformer(baseTransformer),
    api_base_url: p.apiBaseUrl,
    // DB value verbatim: null when unset. Never coerced to ''.
    api_key: p.apiKey,
    auth_mode: p.authMode,
    models: p.models.map((m) => m.name),
    ...(deprecatedModels.length > 0 ? { deprecatedModels } : {}),
    ...(tested.length > 0 ? { modelTestStatus } : {}),
    ...(withContext.length > 0 ? { modelContextWindows } : {}),
    ...(withPrice.length > 0 ? { modelPrices } : {}),
    // transformer is stored as JSONB; we re-derive _disabledModels from
    // Model.enabled so the UI sees the DB truth (the column on disk no
    // longer carries _disabledModels — see applyProviders).
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
      include: { model: { include: { provider: true } } }
    })
  ])

  const router = emptyRouter()
  for (const slot of slots) {
    // slot.scenario is the Prisma ScenarioKey enum; assignable to the
    // local ScenarioKey union without a cast.
    const key: ScenarioKey = slot.scenario
    router[key] = formatSlot(slot.model?.provider, slot.model)
    if (key === 'longContext') {
      const threshold = thresholdFromParams(slot.params)
      if (threshold !== null) router.longContextThreshold = threshold
    }
    if (key === 'default') {
      const margin = weeklyDrainMarginPctFromParams(slot.params)
      if (margin !== null) router.weeklyDrainMarginPct = margin
    }
    const fallbacks = fallbacksFromParams(slot.params)
    if (fallbacks) router.fallbacks[key] = fallbacks
    // Emit force for any slot that has it set, image included, so the UI
    // checkbox reloads with the saved state. image force is a runtime no-op
    // (see RouterForceSchema).
    if (forceFromParams(slot.params)) router.force[key] = true
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
