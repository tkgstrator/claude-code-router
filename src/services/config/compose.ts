/**
 * Read-side composition: join the on-disk envelope with the DB-resident
 * Providers / Router tables into the `AppConfig` shape consumed by the
 * API / UI.
 */

import type { AppConfig, Provider, Router } from '@/schemas'
import type { ConfigEnvelope, ScenarioKey } from '@/shared'
import { getPrismaClient } from '../../db/client'
import {
  AuthMode,
  type Model as DbModel,
  type Provider as DbProvider,
  ModelTestStatus
} from '../../generated/prisma/client'
import { readConfigFile } from '../../lib/configEnvelope'
import { isJsonObject, providerEnabledFromTransformer } from './transformer'

// Unassigned slots are null (not '') so "no model bound" reads the
// same on the wire as everywhere else.
export const emptyRouter = (): Router => ({
  default: null,
  background: null,
  think: null,
  longContext: null,
  webSearch: null,
  image: null,
  longContextThreshold: 60_000
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
  }

  // Optional path/url scalars: emit null when absent / '' on disk so
  // the JSON editor / wire shows "no value" consistently.
  const claudePath = envelopeOnly.CLAUDE_PATH
  const proxyUrl = envelopeOnly.PROXY_URL
  const customRouterPath = envelopeOnly.CUSTOM_ROUTER_PATH
  return {
    ...envelopeOnly,
    CLAUDE_PATH: typeof claudePath === 'string' && claudePath.length > 0 ? claudePath : null,
    PROXY_URL: typeof proxyUrl === 'string' && proxyUrl.length > 0 ? proxyUrl : null,
    CUSTOM_ROUTER_PATH: typeof customRouterPath === 'string' && customRouterPath.length > 0 ? customRouterPath : null,
    Providers: providers.map(toProvider),
    Router: router
  }
}

export async function loadFullConfig(): Promise<AppConfig> {
  return composeUiConfig()
}
