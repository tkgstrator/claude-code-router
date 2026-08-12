/**
 * Read / write the singleton RouterPreferenceProfile (Phase 2b).
 *
 * The apply path is dedicated (not routed through ApplyConfigPayload)
 * so unknown keys can't quietly land on disk via the envelope
 * catchall — see plan doc "What NOT to do" item on ApplyConfigPayload.
 * Writes happen inside a single `prisma.$transaction` so the entries
 * are always a total-order replacement (no partial state).
 */

import { getPrismaClient } from '../db/client'
import { Prisma, type PrismaClient } from '../generated/prisma/client'
import { logger } from '../logger'
import type { RouterPreferenceEntry, RouterPreferenceProfile } from '../schemas'

// One row we can render as a wire-format entry: joins the Model + Provider
// name so we can rebuild the "providerName,modelName" target string.
interface DbEntryRow {
  priority: number
  enabled: boolean
  subagentTiers: string[]
  model: { name: string; provider: { name: string } }
}

// Narrow the DB's plain string[] to the schema's RequestedModelTier
// union: filter to the known tier values so a bad row written by an
// older code path can't crash the wire renderer. Anything unrecognised
// is silently dropped from the returned array.
const ALLOWED_TIERS = new Set(['fable', 'opus', 'sonnet', 'haiku'])
const narrowSubagentTiers = (raw: string[]): RouterPreferenceEntry['subagentTiers'] =>
  raw.flatMap((t) => (ALLOWED_TIERS.has(t) ? [t as 'fable' | 'opus' | 'sonnet' | 'haiku'] : []))

const dbEntryToWire = (row: DbEntryRow): RouterPreferenceEntry => ({
  priority: row.priority,
  target: `${row.model.provider.name},${row.model.name}`,
  enabled: row.enabled,
  subagentTiers: narrowSubagentTiers(row.subagentTiers)
})

// Load the singleton profile with entries in priority order. Returns an
// empty chain + null constraints when the seed row hasn't been created
// yet (fresh DB before ensurePreferenceProfile ran).
export async function loadRouterPreferences(
  prisma: PrismaClient = getPrismaClient()
): Promise<RouterPreferenceProfile> {
  const profile = await prisma.routerPreferenceProfile.findUnique({
    where: { key: 'live' },
    include: {
      entries: {
        orderBy: { priority: 'asc' },
        include: { model: { include: { provider: true } } }
      }
    }
  })
  if (profile === null) return { entries: [], constraints: null }
  return {
    entries: profile.entries.map(dbEntryToWire),
    // `constraints` is Prisma.JsonValue at the type layer. The wire
    // schema narrows it to Record<string, any> | null; anything the DB
    // returned that isn't an object collapses to null so downstream
    // parsing never blows up.
    constraints:
      profile.constraints !== null && typeof profile.constraints === 'object' && !Array.isArray(profile.constraints)
        ? (profile.constraints as Record<string, unknown>)
        : null
  }
}

interface ApplyOutcome {
  success: boolean
  warnings: string[]
}

// Replace the chain atomically. `entries` targets that don't resolve to
// a Model row are dropped with a warning so a stale target from an
// earlier UI session doesn't fail the whole apply.
export async function applyRouterPreferences(
  input: RouterPreferenceProfile,
  prisma: PrismaClient = getPrismaClient()
): Promise<ApplyOutcome> {
  const warnings: string[] = []
  const resolvedTargets = new Map<string, string>()
  for (const entry of input.entries) {
    const parts = entry.target.split(',')
    if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
      warnings.push(`Dropped preference entry with malformed target "${entry.target}".`)
      continue
    }
    const [providerName, modelName] = parts
    const model = await prisma.model.findFirst({
      where: { name: modelName, provider: { name: providerName } },
      select: { id: true }
    })
    if (model === null) {
      warnings.push(`Dropped preference entry: unknown model "${entry.target}".`)
      continue
    }
    resolvedTargets.set(entry.target, model.id)
  }

  const validEntries = input.entries.flatMap((entry) => {
    const modelId = resolvedTargets.get(entry.target)
    if (modelId === undefined) return []
    return [{ entry, modelId }]
  })

  // JSONB write: DbNull writes SQL NULL; a plain object writes JSONB.
  // Never emit JS null directly because the Prisma nullable-JSON column
  // rejects it — DbNull is the documented sentinel.
  const constraintsWrite: Prisma.InputJsonValue | typeof Prisma.DbNull =
    input.constraints === null ? Prisma.DbNull : (input.constraints as Prisma.InputJsonValue)
  await prisma.$transaction(async (tx) => {
    const profile = await tx.routerPreferenceProfile.upsert({
      where: { key: 'live' },
      update: { constraints: constraintsWrite },
      create: { key: 'live', constraints: constraintsWrite }
    })
    // Total-order replacement: drop the current entries, insert the
    // resolved set. Priority is normalised to 1..N so partial UIs (say
    // only 3 entries with priorities 1, 5, 10) still get a dense chain.
    await tx.routerPreferenceEntry.deleteMany({ where: { profileId: profile.id } })
    if (validEntries.length === 0) return
    await tx.routerPreferenceEntry.createMany({
      data: validEntries
        .sort((a, b) => a.entry.priority - b.entry.priority)
        .map(({ entry, modelId }, index) => ({
          profileId: profile.id,
          priority: index + 1,
          modelId,
          enabled: entry.enabled,
          // Widen from RequestedModelTier[] to string[] for Prisma;
          // no cast — .map returns a fresh string[].
          subagentTiers: entry.subagentTiers.map((t) => t)
        }))
    })
  })

  if (warnings.length > 0) {
    logger.warn({ warnings }, '[router-preferences] apply completed with warnings')
  }
  return { success: true, warnings }
}
