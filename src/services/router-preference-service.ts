/**
 * Read / write the singleton RouterPreferenceProfile.
 *
 * The apply path is dedicated (not routed through ApplyConfigPayload)
 * so unknown keys can't quietly land on disk via the envelope
 * catchall — see plan doc "What NOT to do" item on ApplyConfigPayload.
 * Writes happen inside a single `prisma.$transaction` so entries are
 * always a total-order replacement (no partial state).
 *
 * Per-scenario / per-kind chains: each `(ScenarioKey, RouterPreferenceKind)`
 * pair owns an independent priority chain. The wire shape carries an
 * `entriesByScenario` object with a key for every scenario, each mapping
 * to `{ agent: [], subagent: [] }` so the UI can render an empty
 * sub-tab without hitting a "missing" branch.
 */

import { getPrismaClient } from '../db/client'
import {
  Prisma,
  type PrismaClient,
  type RouterPreferenceKind as PrismaKind,
  type ScenarioKey as PrismaScenarioKey
} from '../generated/prisma/client'
import { logger } from '../logger'
import type {
  PreferenceEntriesByKind,
  PreferenceEntriesByScenario,
  PreferenceKind,
  RouterPreferenceEntry,
  RouterPreferenceProfile,
  ScenarioKey
} from '../schemas'

// Every scenario the wire shape carries. Kept as a static tuple so
// adding a new ScenarioKey in Prisma requires touching this file too
// (the tsc failure is the reminder).
const ALL_SCENARIOS: readonly ScenarioKey[] = ['default', 'think', 'longContext', 'webSearch', 'image']
const ALL_KINDS: readonly PreferenceKind[] = ['agent', 'subagent']

interface DbEntryRow {
  scenario: PrismaScenarioKey
  kind: PrismaKind
  priority: number
  enabled: boolean
  model: { name: string; manualTier: string | null; provider: { name: string } }
}

const ALLOWED_TIERS = new Set(['fable', 'opus', 'sonnet', 'haiku'])
type CanonicalTier = 'fable' | 'opus' | 'sonnet' | 'haiku'
const narrowTier = (raw: string | null | undefined): CanonicalTier | null => {
  if (raw === null || raw === undefined) return null
  return ALLOWED_TIERS.has(raw) ? (raw as CanonicalTier) : null
}

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
    resolvedTier: resolved
  }
}

const emptyByKind = (): PreferenceEntriesByKind => ({ agent: [], subagent: [] })

const emptyEntriesByScenario = (): PreferenceEntriesByScenario => ({
  default: emptyByKind(),
  think: emptyByKind(),
  longContext: emptyByKind(),
  webSearch: emptyByKind(),
  image: emptyByKind()
})

/**
 * The profile every surface uses until it is pointed somewhere else.
 *
 * `RouterPreferenceProfile.key` was always intended to key more than one
 * profile; it just had a single 'live' row. Per-surface routing gives it
 * its purpose, so the literal lives here — the module that owns profiles
 * — rather than being repeated at each call site.
 */
export const DEFAULT_PROFILE_KEY = 'live'

// Load one profile with entries in priority order, grouped by scenario
// then by kind. Returns an empty per-scenario map + null constraints
// when the row hasn't been created yet — which is also what a surface
// pointed at a profile nobody has configured should see.
export async function loadRouterPreferences(
  prisma: PrismaClient = getPrismaClient(),
  profileKey: string = DEFAULT_PROFILE_KEY
): Promise<RouterPreferenceProfile> {
  const profile = await prisma.routerPreferenceProfile.findUnique({
    where: { key: profileKey },
    include: {
      entries: {
        orderBy: [{ scenario: 'asc' }, { kind: 'asc' }, { priority: 'asc' }],
        include: { model: { include: { provider: true } } }
      }
    }
  })
  const entriesByScenario = emptyEntriesByScenario()
  if (profile !== null) {
    for (const row of profile.entries) {
      const scenario: ScenarioKey = row.scenario
      const kind: PreferenceKind = row.kind
      entriesByScenario[scenario][kind].push(dbEntryToWire(row))
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
// single (scenario, kind). Loads the whole profile then returns one
// slice; the caller is expected to already need `constraints` anyway.
export async function loadPreferenceChain(
  scenario: ScenarioKey,
  kind: PreferenceKind,
  prisma: PrismaClient = getPrismaClient(),
  profileKey: string | undefined = DEFAULT_PROFILE_KEY
): Promise<{ entries: readonly RouterPreferenceEntry[]; constraints: Record<string, unknown> | null }> {
  const key = profileKey === undefined ? DEFAULT_PROFILE_KEY : profileKey
  const profile = await loadRouterPreferences(prisma, key)
  return { entries: profile.entriesByScenario[scenario][kind], constraints: profile.constraints }
}

interface ApplyOutcome {
  success: boolean
  warnings: string[]
}

interface ResolvedInsert {
  scenario: ScenarioKey
  kind: PreferenceKind
  modelId: string
  enabled: boolean
  originalPriority: number
}

async function resolveEntries(
  prisma: PrismaClient,
  scenario: ScenarioKey,
  kind: PreferenceKind,
  entries: readonly RouterPreferenceEntry[],
  warnings: string[]
): Promise<ResolvedInsert[]> {
  const out: ResolvedInsert[] = []
  for (const entry of entries) {
    const parts = entry.target.split(',')
    if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
      warnings.push(`Dropped ${scenario}/${kind} preference entry with malformed target "${entry.target}".`)
      continue
    }
    const [providerName, modelName] = parts
    const model = await prisma.model.findFirst({
      where: { name: modelName, provider: { name: providerName } },
      select: { id: true }
    })
    if (model === null) {
      warnings.push(`Dropped ${scenario}/${kind} preference entry: unknown model "${entry.target}".`)
      continue
    }
    out.push({
      scenario,
      kind,
      modelId: model.id,
      enabled: entry.enabled,
      originalPriority: entry.priority
    })
  }
  return out.sort((a, b) => a.originalPriority - b.originalPriority)
}

// Replace every (scenario, kind) chain atomically. Priorities normalise
// to dense 1..N per (scenario, kind). Any target that doesn't resolve
// to a Model row is dropped with a warning so a stale entry from an
// earlier UI session doesn't fail the whole apply.
export async function applyRouterPreferences(
  input: RouterPreferenceProfile,
  prisma: PrismaClient = getPrismaClient(),
  profileKey: string = DEFAULT_PROFILE_KEY
): Promise<ApplyOutcome> {
  const warnings: string[] = []
  const resolvedPerChain = new Map<string, ResolvedInsert[]>()
  const chainKey = (scenario: ScenarioKey, kind: PreferenceKind): string => `${scenario}::${kind}`
  for (const scenario of ALL_SCENARIOS) {
    for (const kind of ALL_KINDS) {
      const entries = input.entriesByScenario[scenario][kind]
      const resolved = await resolveEntries(prisma, scenario, kind, entries, warnings)
      resolvedPerChain.set(chainKey(scenario, kind), resolved)
    }
  }

  const constraintsWrite: Prisma.InputJsonValue | typeof Prisma.DbNull =
    input.constraints === null ? Prisma.DbNull : (input.constraints as Prisma.InputJsonValue)

  await prisma.$transaction(async (tx) => {
    const profile = await tx.routerPreferenceProfile.upsert({
      where: { key: profileKey },
      update: { constraints: constraintsWrite },
      create: { key: profileKey, constraints: constraintsWrite }
    })
    // Total-order replacement across every (scenario, kind) chain in
    // one shot so callers can't observe a partial chain mid-write.
    await tx.routerPreferenceEntry.deleteMany({ where: { profileId: profile.id } })
    const flat: Prisma.RouterPreferenceEntryCreateManyInput[] = []
    for (const scenario of ALL_SCENARIOS) {
      for (const kind of ALL_KINDS) {
        const rows = resolvedPerChain.get(chainKey(scenario, kind)) ?? []
        rows.forEach((r, idx) => {
          flat.push({
            profileId: profile.id,
            scenario: r.scenario,
            kind: r.kind,
            priority: idx + 1,
            modelId: r.modelId,
            enabled: r.enabled
          })
        })
      }
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

/**
 * Every configured profile key, with how many entries each holds.
 *
 * The Routing screen offers these when pointing a surface at a profile.
 * The default key is always present even with no row yet, because a
 * surface may reference it before anyone has configured it.
 */
export async function listPreferenceProfiles(
  prisma: PrismaClient = getPrismaClient()
): Promise<Array<{ key: string; entryCount: number; updatedAt: string | null }>> {
  const rows = await prisma.routerPreferenceProfile.findMany({
    orderBy: { key: 'asc' },
    include: { _count: { select: { entries: true } } }
  })
  const listed = rows.map((r) => ({
    key: r.key,
    entryCount: r._count.entries,
    updatedAt: r.updatedAt.toISOString()
  }))
  return listed.some((p) => p.key === DEFAULT_PROFILE_KEY)
    ? listed
    : [{ key: DEFAULT_PROFILE_KEY, entryCount: 0, updatedAt: null }, ...listed]
}
