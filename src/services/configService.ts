/**
 * The only module that knows the DB exists.
 *
 * Everything else (server.ts, index.ts, hooks) talks to the same shape
 * the legacy `readConfigFile()` returned: an object with `Providers`,
 * `Router`, `transformers`, plus envelope scalars. composeUiConfig
 * joins the three tables back into that shape; applyUiConfig diffs an
 * incoming UI payload against DB state in a single transaction.
 */

import { buildSeedProviders, type ConfigEnvelope, SCENARIO_KEYS, type ScenarioKey } from '@ccr/shared'
import { isDeprecatedModel, SUBSCRIPTION_PRESETS } from '@ccr/shared/data'
import { getPrismaClient } from '../db/client'
import {
  ApiStyle,
  AuthMode,
  type Model as DbModel,
  type Provider as DbProvider,
  ModelTestStatus,
  Prisma,
  type PrismaClient
} from '../generated/prisma/client'

import { backupConfigFile, readConfigFile, writeConfigFile } from '../lib/configEnvelope'

// Explicit per-provider request shape. No runtime fallback — every
// seeded provider gets a concrete value written to the DB.
export const apiStyleForVendor = (name: string): ApiStyle => {
  if (name === 'anthropic' || name === 'claude-code') return ApiStyle.anthropic
  if (name === 'google') return ApiStyle.gemini
  if (name === 'codex') return ApiStyle.openai_responses
  return ApiStyle.openai_chat
}

// Per-model override stored on Model.apiStyle. Codex-family models are
// Responses-only even when hosted under the regular (chat) openai
// provider, so they need an explicit endpoint stored on the row.
// Returns null when the model should inherit the provider's apiStyle.
export const modelApiStyleOverride = (modelName: string): ApiStyle | null =>
  /codex/i.test(modelName) ? ApiStyle.openai_responses : null

// Model names in a provider transformer's `_disabledModels` list.
const disabledSet = (transformer: unknown): Set<string> => {
  const raw =
    transformer && typeof transformer === 'object'
      ? (transformer as Record<string, unknown>)._disabledModels
      : undefined
  return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [])
}

// --- Shapes the UI sees -----------------------------------------------------

// Mirrors packages/ui/src/types.ts Provider.
type UiProvider = {
  name: string
  api_base_url: string
  api_key: string
  auth_mode: 'api_key' | 'subscription'
  models: string[]
  // Subset of `models` whose Model.deprecated row is true. Surfaced as a
  // parallel array so the wire shape for `models` stays a plain
  // string[] — UI callers that don't care about deprecation keep
  // working untouched.
  deprecatedModels?: string[]
  // Per-model last real-inference test outcome, keyed by model name.
  // Parallel map so `models` stays a plain string[]; absent when no
  // model has been tested.
  modelTestStatus?: Record<string, { status: 'unknown' | 'ok' | 'fail'; passedAt: string | null }>
  transformer?: Record<string, unknown>
}

// Mirrors packages/ui/src/types.ts RouterConfig. Slot values are
// "providerName,modelName" strings (or "" when unset).
type UiRouter = {
  default: string
  background: string
  think: string
  longContext: string
  longContextThreshold?: number
  webSearch: string
  image: string
} & Record<string, string | number>

// The legacy response shape. Typed envelope scalars (so call sites like
// `config.APIKEY` keep working) + Providers/Router. We can't extend
// ConfigEnvelope here because its zod-derived index signature
// constrains every property to JsonValue, and UiProvider (with its
// open-ended transformer field) deliberately is not one.
export type LegacyConfig = {
  Providers: UiProvider[]
  Router: UiRouter
  HOST?: string
  PORT?: number
  APIKEY?: string
  LOG?: boolean
  LOG_LEVEL?: string
  PROXY_URL?: string
  API_TIMEOUT_MS?: number | string
  CLAUDE_PATH?: string
  NON_INTERACTIVE_MODE?: boolean
  StatusLine?: unknown
  transformers?: unknown[]
  plugins?: unknown[]
  Plugins?: unknown[]
  [key: string]: unknown
}

// --- Compose ----------------------------------------------------------------

const emptyRouter = (): UiRouter => ({
  default: '',
  background: '',
  think: '',
  longContext: '',
  webSearch: '',
  image: ''
})

const formatSlot = (provider: DbProvider | null | undefined, model: DbModel | null | undefined): string =>
  provider && model ? `${provider.name},${model.name}` : ''

type ProviderWithModels = DbProvider & { models: DbModel[] }

const toUiProvider = (p: ProviderWithModels): UiProvider => {
  const deprecatedModels = p.models.filter((m) => m.deprecated).map((m) => m.name)
  // Model.enabled is the source of truth. Reconstruct the legacy
  // transformer._disabledModels view so the existing provider editor
  // and ModelsDashboard (both read that list) reflect the DB without
  // any UI change.
  const disabledModels = p.models.filter((m) => !m.enabled).map((m) => m.name)
  const baseTransformer =
    p.transformer && typeof p.transformer === 'object' ? (p.transformer as Record<string, unknown>) : undefined
  const transformerOut =
    baseTransformer || disabledModels.length > 0
      ? { ...(baseTransformer ?? {}), ...(disabledModels.length > 0 ? { _disabledModels: disabledModels } : {}) }
      : undefined
  const tested = p.models.filter((m) => m.testStatus !== 'unknown')
  const modelTestStatus = Object.fromEntries(
    tested.map((m) => [
      m.name,
      {
        status: m.testStatus as 'unknown' | 'ok' | 'fail',
        passedAt: m.testPassedAt ? m.testPassedAt.toISOString() : null
      }
    ])
  )
  return {
    name: p.name,
    api_base_url: p.apiBaseUrl,
    api_key: p.apiKey,
    auth_mode: p.authMode,
    models: p.models.map((m) => m.name),
    ...(deprecatedModels.length > 0 ? { deprecatedModels } : {}),
    ...(tested.length > 0 ? { modelTestStatus } : {}),
    // transformer is stored as JSONB; we re-derive _disabledModels from
    // Model.enabled so the UI sees the DB truth (the column on disk no
    // longer carries _disabledModels — see applyProviders).
    ...(transformerOut ? { transformer: transformerOut } : {})
  }
}

export async function composeUiConfig(): Promise<LegacyConfig> {
  const envelope = (await readConfigFile()) as ConfigEnvelope
  // The envelope on disk may still carry legacy Providers/Router during
  // the migration window; strip them so the composed result is the DB's
  // view, not stale disk content.
  const { Providers: _p, providers: _pl, Router: _r, ...envelopeOnly } = envelope as Record<string, unknown>

  const prisma = getPrismaClient()
  const [providers, slots] = await Promise.all([
    prisma.provider.findMany({
      include: { models: true },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.routerSlot.findMany({
      include: { model: { include: { provider: true } } }
    })
  ])

  const router = emptyRouter()
  for (const slot of slots) {
    const key = slot.scenario as ScenarioKey
    router[key] = formatSlot(slot.model?.provider, slot.model)
    if (key === 'longContext' && slot.params && typeof slot.params === 'object' && 'threshold' in slot.params) {
      const t = (slot.params as { threshold?: unknown }).threshold
      if (typeof t === 'number') router.longContextThreshold = t
    }
  }

  return {
    ...(envelopeOnly as ConfigEnvelope),
    Providers: providers.map(toUiProvider),
    Router: router
  }
}

// --- Apply ------------------------------------------------------------------

export type ApplyResult = {
  success: true
  warnings: string[]
}

// Pull a "providerName,modelName" string apart. Empty / malformed input
// resolves to null,null — the slot will be nulled out.
const parseSlot = (raw: unknown): { providerName: string | null; modelName: string | null } => {
  if (typeof raw !== 'string' || raw.length === 0) return { providerName: null, modelName: null }
  const [p, m] = raw.split(',')
  if (!p || !m) return { providerName: null, modelName: null }
  return { providerName: p.trim(), modelName: m.trim() }
}

// Envelope keys live on disk; Providers/Router live in DB. Everything
// else (StatusLine, transformers, plugins, …) stays on disk for PR #1.
const splitPayload = (payload: Record<string, unknown>) => {
  const { Providers, providers, Router, ...envelope } = payload
  const incomingProviders = (
    Array.isArray(Providers) ? Providers : Array.isArray(providers) ? providers : []
  ) as UiProvider[]
  const incomingRouter = (Router && typeof Router === 'object' ? Router : {}) as Partial<UiRouter>
  return { envelope: envelope as ConfigEnvelope, incomingProviders, incomingRouter }
}

export async function applyUiConfig(payload: Record<string, unknown>): Promise<ApplyResult> {
  const { envelope, incomingProviders, incomingRouter } = splitPayload(payload)
  const warnings: string[] = []

  const prisma = getPrismaClient()

  // The whole DB mutation is one interactive transaction so we never leave
  // a Provider deleted with a RouterSlot still pointing at one of its
  // models (which Restrict would block mid-way otherwise).
  await prisma.$transaction(async (tx) => {
    await applyProviders(tx, incomingProviders, warnings)
    await applyRouter(tx, incomingRouter, warnings)
  })

  // Envelope changes happen on disk after the DB transaction commits;
  // we accept the small window where the two stores disagree because
  // failing the file write after a DB commit is no worse than failing
  // the DB write after a file write — and the file is the smaller of
  // the two surfaces.
  await backupConfigFile()
  await writeConfigFile(envelope)

  return { success: true, warnings }
}

// --- Apply: providers / models ---------------------------------------------

// Prisma 7 hangs the transaction-client type off the namespace export.
type Tx = Prisma.TransactionClient

async function applyProviders(tx: Tx, incoming: UiProvider[], warnings: string[]): Promise<void> {
  const existing = await tx.provider.findMany({ include: { models: true } })
  const incomingByName = new Map(incoming.map((p) => [p.name, p]))

  // Delete providers the UI no longer lists. Clear any RouterSlot
  // pointing at a doomed model first (Restrict would otherwise abort).
  for (const ex of existing) {
    if (incomingByName.has(ex.name)) continue
    const cleared = await tx.routerSlot.updateMany({
      where: { model: { providerId: ex.id } },
      data: { modelId: null }
    })
    if (cleared.count > 0) {
      warnings.push(`Cleared ${cleared.count} router slot(s) bound to deleted provider "${ex.name}".`)
    }
    await tx.provider.delete({ where: { id: ex.id } })
  }

  // Upsert what remains.
  for (const inc of incoming) {
    const authMode: AuthMode = inc.auth_mode === 'subscription' ? AuthMode.subscription : AuthMode.api_key
    // The UI still expresses enable/disable via transformer
    // ._disabledModels; that's translated into the authoritative
    // Model.enabled column below and stripped from the stored
    // transformer so we never keep a stale duplicate on disk.
    const nextDisabled = disabledSet(inc.transformer)
    const prevProvider = existing.find((e) => e.name === inc.name)
    const prevEnabledByName = new Map(prevProvider?.models.map((m) => [m.name, m.enabled]) ?? [])
    const incTransformer =
      inc.transformer && typeof inc.transformer === 'object' ? (inc.transformer as Record<string, unknown>) : undefined
    const storedTransformer = (() => {
      if (!incTransformer) return undefined
      const { _disabledModels: _omit, ...rest } = incTransformer
      return Object.keys(rest).length > 0 ? (rest as Prisma.InputJsonValue) : undefined
    })()
    const provider = await tx.provider.upsert({
      where: { name: inc.name },
      update: {
        apiBaseUrl: inc.api_base_url,
        apiKey: inc.api_key,
        authMode,
        transformer: storedTransformer ?? Prisma.DbNull
      },
      create: {
        name: inc.name,
        apiBaseUrl: inc.api_base_url,
        apiKey: inc.api_key,
        authMode,
        transformer: storedTransformer ?? Prisma.DbNull
      },
      include: { models: true }
    })

    const desired = new Set(inc.models)
    const existingNames = new Set(provider.models.map((m) => m.name))
    const toDelete = [...existingNames].filter((n) => !desired.has(n))
    const toCreate = [...desired].filter((n) => !existingNames.has(n))

    if (toDelete.length > 0) {
      const cleared = await tx.routerSlot.updateMany({
        where: { model: { providerId: provider.id, name: { in: toDelete } } },
        data: { modelId: null }
      })
      if (cleared.count > 0) {
        warnings.push(
          `Cleared ${cleared.count} router slot(s) for "${provider.name}" model(s) removed in this save: ${toDelete.join(', ')}.`
        )
      }
      await tx.model.deleteMany({
        where: { providerId: provider.id, name: { in: toDelete } }
      })
    }
    if (toCreate.length > 0) {
      await tx.model.createMany({
        // enabled omitted -> DB default (false). The authoritative
        // enabled state is written just below from the UI's selection.
        data: toCreate.map((name) => ({
          providerId: provider.id,
          name,
          deprecated: isDeprecatedModel(name),
          apiStyle: modelApiStyleOverride(name)
        }))
      })
    }

    // Write the authoritative Model.enabled column from the UI's
    // _disabledModels selection, and reset the persisted test status
    // for any model whose enabled state actually flipped (a
    // re-enabled model shouldn't show a stale pass/fail; a disabled
    // one shouldn't keep a result).
    const desiredNames = [...desired]
    const toEnable = desiredNames.filter((n) => !nextDisabled.has(n))
    const toDisable = desiredNames.filter((n) => nextDisabled.has(n))
    const flipped = desiredNames.filter((n) => {
      const prev = prevEnabledByName.get(n)
      return prev !== undefined && prev !== !nextDisabled.has(n)
    })
    if (toEnable.length > 0) {
      await tx.model.updateMany({
        where: { providerId: provider.id, name: { in: toEnable }, enabled: false },
        data: { enabled: true }
      })
    }
    if (toDisable.length > 0) {
      await tx.model.updateMany({
        where: { providerId: provider.id, name: { in: toDisable }, enabled: true },
        data: { enabled: false }
      })
    }
    if (flipped.length > 0) {
      await tx.model.updateMany({
        where: { providerId: provider.id, name: { in: flipped } },
        data: {
          testStatus: ModelTestStatus.unknown,
          testCheckedAt: null,
          testPassedAt: null,
          testError: null
        }
      })
    }
    // Resync the deprecation flag on rows we kept — the registry may
    // have flipped a model between releases, and we don't want a model
    // first seeded as active to silently stay that way.
    await syncDeprecationFlags(
      tx,
      provider.id,
      [...desired].filter((n) => existingNames.has(n))
    )
  }
}

async function syncDeprecationFlags(tx: Tx, providerId: string, names: string[]): Promise<void> {
  if (names.length === 0) return
  const deprecated = names.filter(isDeprecatedModel)
  const active = names.filter((n) => !isDeprecatedModel(n))
  if (deprecated.length > 0) {
    await tx.model.updateMany({
      where: { providerId, name: { in: deprecated }, deprecated: false },
      data: { deprecated: true }
    })
  }
  if (active.length > 0) {
    await tx.model.updateMany({
      where: { providerId, name: { in: active }, deprecated: true },
      data: { deprecated: false }
    })
  }
}

// --- Apply: router slots ----------------------------------------------------

async function applyRouter(tx: Tx, incoming: Partial<UiRouter>, warnings: string[]): Promise<void> {
  const longContextThreshold = typeof incoming.longContextThreshold === 'number' ? incoming.longContextThreshold : null

  for (const scenario of SCENARIO_KEYS) {
    const { providerName, modelName } = parseSlot(incoming[scenario])

    let modelId: string | null = null
    if (providerName && modelName) {
      const model = await tx.model.findFirst({
        where: { name: modelName, provider: { name: providerName } }
      })
      if (model) {
        modelId = model.id
      } else {
        warnings.push(`Router slot "${scenario}" references unknown model "${providerName},${modelName}"; left empty.`)
      }
    }

    const params: Prisma.InputJsonValue | typeof Prisma.DbNull =
      scenario === 'longContext' && longContextThreshold !== null ? { threshold: longContextThreshold } : Prisma.DbNull

    await tx.routerSlot.upsert({
      where: { scenario },
      update: { modelId, params },
      create: { scenario, modelId, params }
    })
  }

  // Surface any catchall (custom) keys we silently drop.
  const knownKeys = new Set<string>([...SCENARIO_KEYS, 'longContextThreshold'])
  const dropped = Object.keys(incoming).filter((k) => !knownKeys.has(k))
  if (dropped.length > 0) {
    warnings.push(`Router fields not yet stored in DB and were ignored: ${dropped.join(', ')}. (See PR #2.)`)
  }
}

// --- Bootstrap / lifecycle --------------------------------------------------

export async function loadFullConfig(): Promise<LegacyConfig> {
  return composeUiConfig()
}

// Every routable model, straight from the DB (Model.enabled is the
// source of truth). Powers the Router selects — they render this list
// verbatim, so disabled models never reach that UI and the frontend
// does zero filtering. Separate from /api/config, which intentionally
// returns the full catalog (ModelsDashboard needs the disabled ones).
export async function getEnabledModels(
  prisma: PrismaClient = getPrismaClient()
): Promise<{ provider: string; model: string }[]> {
  const rows = await prisma.model.findMany({
    where: { enabled: true },
    select: { name: true, provider: { select: { name: true } } },
    orderBy: [{ provider: { name: 'asc' } }, { name: 'asc' }]
  })
  return rows.map((r) => ({ provider: r.provider.name, model: r.name }))
}

// Seed the 6 RouterSlot rows with null modelId if they're missing. Used
// by the JSON-to-DB migration and as a safety net for fresh databases.
export async function ensureRouterSlots(prisma: PrismaClient = getPrismaClient()): Promise<void> {
  await Promise.all(
    SCENARIO_KEYS.map((scenario) =>
      prisma.routerSlot.upsert({
        where: { scenario },
        update: {},
        create: { scenario, modelId: null }
      })
    )
  )
}

// First-run convenience: populate the Provider table from the
// llm-prices snapshot so the UI's Add-Provider dropdown and the catalog
// of available models are non-empty out of the box. api_key is left
// blank — the user fills it in from the UI. Behaviour is top-up: any
// seed whose `name` isn't already in the table gets inserted, so a
// partial DB (e.g. only the openai row lifted by runJsonToDbMigration)
// gains the remaining vendors on next boot. Existing rows are never
// overwritten.
interface SeedRow {
  name: string
  apiBaseUrl: string
  authMode: AuthMode
  apiStyle: ApiStyle
  transformer: Prisma.InputJsonValue | typeof Prisma.DbNull
  models: string[]
}

export async function ensureSeedProviders(prisma: PrismaClient = getPrismaClient()): Promise<void> {
  const existing = await prisma.provider.findMany({ include: { models: true } })
  const existingByName = new Map(existing.map((p) => [p.name, p]))

  const apiSeeds: SeedRow[] = buildSeedProviders().map((seed) => ({
    name: seed.name,
    apiBaseUrl: seed.apiBaseUrl,
    authMode: AuthMode.api_key,
    apiStyle: apiStyleForVendor(seed.name),
    transformer: seed.transformer ?? Prisma.DbNull,
    models: seed.models
  }))
  const subscriptionSeeds: SeedRow[] = SUBSCRIPTION_PRESETS.map((preset) => ({
    name: preset.id,
    apiBaseUrl: preset.apiBaseUrl,
    authMode: AuthMode.subscription,
    apiStyle: apiStyleForVendor(preset.id),
    transformer: Prisma.DbNull,
    models: preset.defaultEnabledModels
  }))
  const allSeeds = [...apiSeeds, ...subscriptionSeeds]

  await prisma.$transaction(async (tx) => {
    for (const seed of allSeeds) {
      const current = existingByName.get(seed.name)
      if (!current) {
        // Brand-new provider: insert provider + every seed model.
        const provider = await tx.provider.create({
          data: {
            name: seed.name,
            apiBaseUrl: seed.apiBaseUrl,
            apiKey: '',
            authMode: seed.authMode,
            apiStyle: seed.apiStyle,
            transformer: seed.transformer
          }
        })
        if (seed.models.length > 0) {
          await tx.model.createMany({
            data: seed.models.map((name) => ({
              providerId: provider.id,
              name,
              deprecated: isDeprecatedModel(name),
              // Registered != routable. Only subscription presets seed
              // their curated default set as enabled; api_key vendor
              // catalogs stay off (DB default) until the user enables.
              enabled: seed.authMode === AuthMode.subscription && !isDeprecatedModel(name),
              apiStyle: modelApiStyleOverride(name)
            }))
          })
        }
        continue
      }
      // Provider already exists. Top-up missing models only — never
      // delete or rename. The provider row's apiBaseUrl / authMode /
      // transformer stay as the user has them.
      const existingModelNames = new Set(current.models.map((m) => m.name))
      const newModels = seed.models.filter((name) => !existingModelNames.has(name))
      if (newModels.length > 0) {
        await tx.model.createMany({
          data: newModels.map((name) => ({
            providerId: current.id,
            name,
            deprecated: isDeprecatedModel(name),
            enabled: !isDeprecatedModel(name),
            apiStyle: modelApiStyleOverride(name)
          }))
        })
      }
      // Resync deprecation flag for already-seeded rows so new entries
      // added to DEPRECATED_MODELS on upgrade reach existing DBs.
      await syncDeprecationFlags(tx, current.id, seed.models)
    }
  })
}
