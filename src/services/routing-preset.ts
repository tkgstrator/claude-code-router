/**
 * CRUD for RoutingPreset — user-saved Router snapshots. Applying a
 * preset is client-side (it just replaces the RoutingEditor's draft
 * state), so this service is a plain typed wrapper over Prisma with no
 * cross-table integrity to enforce.
 */

import { getPrismaClient } from '../db/client'
import type { Prisma } from '../generated/prisma/client'
import type { CreateRoutingPreset, RouterConfig, RoutingPreset, UpdateRoutingPreset } from '../schemas'
import { RouterConfigSchema } from '../schemas'

// RouterConfig carries an `unknown` `custom` field; Prisma's InputJsonValue
// rejects unknown. The value HAS already been validated by RouterConfigSchema
// at the API boundary, so bounce it through a JSON round-trip. JSON.parse
// returns `any`, which satisfies InputJsonValue without an explicit cast —
// and a non-JSON value would have failed the schema parse upstream.
const configToJson = (config: RouterConfig): Prisma.InputJsonValue => JSON.parse(JSON.stringify(config))

// The `config` column is JSONB. Prisma types it as JsonValue, but at
// this boundary we validate it against RouterConfigSchema so the wire
// shape stays typed — a malformed snapshot in the DB (hand-edited row,
// pre-migration data) throws here rather than propagating garbage into
// the editor. safeParse keeps the failure explicit; the caller surfaces
// the id in the error so the offender is identifiable.
function normalize(row: {
  id: string
  name: string
  config: unknown
  createdAt: Date
  updatedAt: Date
}): RoutingPreset {
  const parsed = RouterConfigSchema.safeParse(row.config)
  if (!parsed.success) {
    throw new Error(`RoutingPreset ${row.id} has an invalid config: ${parsed.error.message}`)
  }
  return {
    id: row.id,
    name: row.name,
    config: parsed.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export async function listRoutingPresets(): Promise<RoutingPreset[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.routingPreset.findMany({ orderBy: { updatedAt: 'desc' } })
  return rows.map(normalize)
}

export async function createRoutingPreset(input: CreateRoutingPreset): Promise<RoutingPreset> {
  const prisma = getPrismaClient()
  const row = await prisma.routingPreset.create({
    data: { name: input.name, config: configToJson(input.config) }
  })
  return normalize(row)
}

export async function updateRoutingPreset(id: string, input: UpdateRoutingPreset): Promise<RoutingPreset | null> {
  const prisma = getPrismaClient()
  const existing = await prisma.routingPreset.findUnique({ where: { id } })
  if (existing === null) return null
  const row = await prisma.routingPreset.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.config === undefined ? {} : { config: configToJson(input.config) })
    }
  })
  return normalize(row)
}

export async function deleteRoutingPreset(id: string): Promise<boolean> {
  const prisma = getPrismaClient()
  const existing = await prisma.routingPreset.findUnique({ where: { id } })
  if (existing === null) return false
  await prisma.routingPreset.delete({ where: { id } })
  return true
}
