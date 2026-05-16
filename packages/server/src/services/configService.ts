/**
 * The only module that knows the DB exists.
 *
 * Everything else (server.ts, index.ts, hooks) talks to the same shape
 * the legacy `readConfigFile()` returned: an object with `Providers`,
 * `Router`, `transformers`, plus envelope scalars. composeUiConfig
 * joins the three tables back into that shape; applyUiConfig diffs an
 * incoming UI payload against DB state in a single transaction.
 */

import { type ConfigEnvelope, SCENARIO_KEYS, type ScenarioKey } from '@ccr/shared'
import { getPrismaClient } from '../db/client'
import {
  type Model as DbModel,
  type Provider as DbProvider,
  Prisma,
  type PrismaClient
} from '../generated/prisma/client'
import { backupConfigFile, readConfigFile, writeConfigFile } from '../utils/index'

// --- Shapes the UI sees -----------------------------------------------------

// Mirrors packages/ui/src/types.ts Provider.
type UiProvider = {
  name: string
  api_base_url: string
  api_key: string
  models: string[]
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

const toUiProvider = (p: ProviderWithModels): UiProvider => ({
  name: p.name,
  api_base_url: p.apiBaseUrl,
  api_key: p.apiKey,
  models: p.models.map((m) => m.name),
  // transformer is stored as JSONB; Prisma returns JsonValue which we
  // surface as a free-form record to the UI (legacy shape is unchanged).
  ...(p.transformer ? { transformer: p.transformer as Record<string, unknown> } : {})
})

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
    const transformer = inc.transformer as Prisma.InputJsonValue | undefined
    const provider = await tx.provider.upsert({
      where: { name: inc.name },
      update: {
        apiBaseUrl: inc.api_base_url,
        apiKey: inc.api_key,
        transformer: transformer ?? Prisma.DbNull
      },
      create: {
        name: inc.name,
        apiBaseUrl: inc.api_base_url,
        apiKey: inc.api_key,
        transformer: transformer ?? Prisma.DbNull
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
        data: toCreate.map((name) => ({ providerId: provider.id, name }))
      })
    }
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
