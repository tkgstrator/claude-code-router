/**
 * Read / write the singleton RouterPreferenceProfile.
 *
 * The apply path is dedicated (not routed through ApplyConfigPayload)
 * so unknown keys can't quietly land on disk via the envelope
 * catchall — see plan doc "What NOT to do" item on ApplyConfigPayload.
 * Writes happen inside a single `prisma.$transaction` so entries are
 * always a total-order replacement (no partial state).
 *
 * Per-scenario chains: each `ScenarioKey` owns an independent priority
 * chain. The wire shape carries an `entriesByScenario` object with a
 * key for every scenario so the UI can render an empty tab without
 * hitting a "missing scenario" branch.
 */

import { getPrismaClient } from '../db/client'
import { Prisma, type PrismaClient, type ScenarioKey as PrismaScenarioKey } from '../generated/prisma/client'
import { logger } from '../logger'
import type {
  PreferenceEntriesByScenario,
  RouterPreferenceEntry,
  RouterPreferenceProfile,
  ScenarioKey
} from '../schemas'

// Every scenario the wire shape carries. Kept as a static tuple so
// adding a new ScenarioKey in Prisma requires touching this file too
// (the tsc failure is the reminder).
const ALL_SCENARIOS: readonly ScenarioKey[] = ['default', 'think', 'longContext', 'webSearch', 'image']

interface DbEntryRow {
  scenario: PrismaScenarioKey
  priority: number
  enabled: boolean
  subagentTiers: string[]
  model: { name: string; manualTier: string | null; provider: { name: string } }
}

const ALLOWED_TIERS = new Set(['fable', 'opus', 'sonnet', 'haiku'])
type CanonicalTier = 'fable' | 'opus' | 'sonnet' | 'haiku'
const narrowTier = (raw: string | null | undefined): CanonicalTier | null => {
  if (raw === null || raw === undefined) return null
  return ALLOWED_TIERS.has(raw) ? (raw as CanonicalTier) : null
}
const narrowSubagentTiers = (raw: string[]): RouterPreferenceEntry['subagentTiers'] =>
  raw.flatMap((t) => (ALLOWED_TIERS.has(t) ? [t as CanonicalTier] : []))

// Name-inference fallback that mirrors the private tierOf() in
// scenario-router/model-selection.ts. Duplicated here (rather than
// imported cross-service) so bun's test-file loader doesn't hit the
// same "Export named not found" quirk we saw with scopedMetricKey.
const inferTier = (modelName: string): CanonicalTier | null => {
  const lower = modelName.toLowerCase()
  if (lower.includes('fable')) return 'fable'
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return null
}

const dbEntryToWire = (row: DbEntryRow): RouterPreferenceEntry => {
  const manual = narrowTier(row.model.manualTier)
  const resolved = manual !== null ? manual : inferTier(row.model.name)
  return {
    priority: row.priority,
    target: `${row.model.provider.name},${row.model.name}`,
    enabled: row.enabled,
    subagentTiers: narrowSubagentTiers(row.subagentTiers),
    resolvedTier: resolved
  }
}

const emptyEntriesByScenario = (): PreferenceEntriesByScenario => ({
  default: [],
  think: [],
  longContext: [],
  webSearch: [],
  image: []
})

// Load the singleton profile with entries in priority order, grouped
// by scenario. Returns an empty per-scenario map + null constraints
// when the seed row hasn't been created yet.
export async function loadRouterPreferences(
  prisma: PrismaClient = getPrismaClient()
): Promise<RouterPreferenceProfile> {
  const profile = await prisma.routerPreferenceProfile.findUnique({
    where: { key: 'live' },
    include: {
      entries: {
        orderBy: [{ scenario: 'asc' }, { priority: 'asc' }],
        include: { model: { include: { provider: true } } }
      }
    }
  })
  const entriesByScenario = emptyEntriesByScenario()
  if (profile !== null) {
    for (const row of profile.entries) {
      const key: ScenarioKey = row.scenario
      entriesByScenario[key].push(dbEntryToWire(row))
    }
  }
  const constraints =
    profile !== null &&
    profile.constraints !== null &&
    typeof profile.constraints === 'object' &&
    !Array.isArray(profile.constraints)
      ? (profile.constraints as Record<string, unknown>)
      : null
  return { entriesByScenario, constraints }
}

// Helper the selector uses at request time — pick the chain for a
// single scenario. Loads the whole profile then returns one slice;
// the caller is expected to already need `constraints` anyway.
export async function loadPreferenceChain(
  scenario: ScenarioKey,
  prisma: PrismaClient = getPrismaClient()
): Promise<{ entries: readonly RouterPreferenceEntry[]; constraints: Record<string, unknown> | null }> {
  const profile = await loadRouterPreferences(prisma)
  return { entries: profile.entriesByScenario[scenario], constraints: profile.constraints }
}

interface ApplyOutcome {
  success: boolean
  warnings: string[]
}

interface ResolvedInsert {
  scenario: ScenarioKey
  modelId: string
  enabled: boolean
  subagentTiers: string[]
  originalPriority: number
}

async function resolveEntries(
  prisma: PrismaClient,
  scenario: ScenarioKey,
  entries: readonly RouterPreferenceEntry[],
  warnings: string[]
): Promise<ResolvedInsert[]> {
  const out: ResolvedInsert[] = []
  for (const entry of entries) {
    const parts = entry.target.split(',')
    if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
      warnings.push(`Dropped ${scenario} preference entry with malformed target "${entry.target}".`)
      continue
    }
    const [providerName, modelName] = parts
    const model = await prisma.model.findFirst({
      where: { name: modelName, provider: { name: providerName } },
      select: { id: true }
    })
    if (model === null) {
      warnings.push(`Dropped ${scenario} preference entry: unknown model "${entry.target}".`)
      continue
    }
    out.push({
      scenario,
      modelId: model.id,
      enabled: entry.enabled,
      subagentTiers: entry.subagentTiers.map((t) => t),
      originalPriority: entry.priority
    })
  }
  return out.sort((a, b) => a.originalPriority - b.originalPriority)
}

// Replace every scenario's chain atomically. Priorities normalise to
// dense 1..N per scenario. Any target that doesn't resolve to a Model
// row is dropped with a warning so a stale entry from an earlier UI
// session doesn't fail the whole apply.
export async function applyRouterPreferences(
  input: RouterPreferenceProfile,
  prisma: PrismaClient = getPrismaClient()
): Promise<ApplyOutcome> {
  const warnings: string[] = []
  const resolvedPerScenario = new Map<ScenarioKey, ResolvedInsert[]>()
  for (const scenario of ALL_SCENARIOS) {
    const entries = input.entriesByScenario[scenario]
    const resolved = await resolveEntries(prisma, scenario, entries, warnings)
    resolvedPerScenario.set(scenario, resolved)
  }

  const constraintsWrite: Prisma.InputJsonValue | typeof Prisma.DbNull =
    input.constraints === null ? Prisma.DbNull : (input.constraints as Prisma.InputJsonValue)

  await prisma.$transaction(async (tx) => {
    const profile = await tx.routerPreferenceProfile.upsert({
      where: { key: 'live' },
      update: { constraints: constraintsWrite },
      create: { key: 'live', constraints: constraintsWrite }
    })
    // Total-order replacement across every scenario in one shot so
    // callers can't observe a partial chain mid-write.
    await tx.routerPreferenceEntry.deleteMany({ where: { profileId: profile.id } })
    const flat: Prisma.RouterPreferenceEntryCreateManyInput[] = []
    for (const scenario of ALL_SCENARIOS) {
      const rows = resolvedPerScenario.get(scenario) ?? []
      rows.forEach((r, idx) => {
        flat.push({
          profileId: profile.id,
          scenario: r.scenario,
          priority: idx + 1,
          modelId: r.modelId,
          enabled: r.enabled,
          subagentTiers: r.subagentTiers
        })
      })
    }
    if (flat.length > 0) {
      await tx.routerPreferenceEntry.createMany({ data: flat })
    }
  })

  if (warnings.length > 0) {
    logger.warn({ warnings }, '[router-preferences] apply completed with warnings')
  }
  return { success: true, warnings }
}
