/**
 * One-shot migration: lift Providers / Router out of config.json into
 * Postgres on the first boot after the user upgrades.
 *
 * Runs idempotently. If config.json no longer carries Providers/Router
 * we return immediately. If the DB already has rows AND the file still
 * carries the legacy keys, we bail loudly without overwriting either
 * side — this is the "user restored both halves" footgun and silently
 * winning either store would be worse than refusing.
 */

import fs from 'node:fs/promises'
import { ProviderConfigSchema, RouterConfigSchema, SCENARIO_KEYS } from '@/shared'
import { CONFIG_FILE } from '@/shared/constants'
import { isDeprecatedModel } from '@/shared/data'
import JSON5 from 'json5'
import { z } from 'zod'
import { Prisma } from '../generated/prisma/client'
import { backupConfigFile, writeConfigFile } from '../lib/configEnvelope'
import { logger } from '../lib/logger'
import { getPrismaClient } from './client'

// --- Schemas ----------------------------------------------------------------

// Extends the shared ProviderConfigSchema with migration-specific overrides:
// api_key is optional (subscription providers have none), transformer is
// typed for Prisma so no cast is needed at the call site.
const LegacyProviderSchema = ProviderConfigSchema.extend({
  api_key: z.string().nonempty().optional(),
  transformer: z.custom<Prisma.InputJsonValue>().optional()
})

type LegacyProvider = z.infer<typeof LegacyProviderSchema>

type LegacyRouter = z.infer<typeof RouterConfigSchema>

const LegacyConfigOnDiskSchema = z
  .object({
    Providers: z.array(LegacyProviderSchema).optional(),
    providers: z.array(LegacyProviderSchema).optional(),
    Router: RouterConfigSchema.optional()
  })
  .catchall(z.unknown())

type LegacyConfigOnDisk = z.infer<typeof LegacyConfigOnDiskSchema>

// --- Types ------------------------------------------------------------------

export type MigrationOutcome =
  | { kind: 'no-config-file' }
  | { kind: 'nothing-to-migrate' }
  | { kind: 'bail-both-populated'; providerCount: number; existingRows: number }
  | { kind: 'migrated'; providerCount: number; modelCount: number; routerSlotsSet: number }

// --- Helpers ----------------------------------------------------------------

type Tx = Parameters<Parameters<ReturnType<typeof getPrismaClient>['$transaction']>[0]>[0]

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

function parseSlot(raw: unknown): { providerName: string; modelName: string } | null {
  if (typeof raw !== 'string' || !raw) return null
  const [providerName, modelName] = raw.split(',')
  if (!providerName || !modelName) return null
  return { providerName: providerName.trim(), modelName: modelName.trim() }
}

async function readDiskConfig(): Promise<LegacyConfigOnDisk | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8')
    return LegacyConfigOnDiskSchema.parse(JSON5.parse(raw))
  } catch (err: unknown) {
    if (isEnoent(err)) return null
    throw err
  }
}

async function seedRouterSlots(tx: Tx): Promise<void> {
  await Promise.all(
    SCENARIO_KEYS.map((scenario) =>
      tx.routerSlot.upsert({
        where: { scenario },
        update: {},
        create: { scenario, modelId: null }
      })
    )
  )
}

async function migrateProviders(tx: Tx, providers: LegacyProvider[]): Promise<number> {
  let modelCount = 0
  for (const p of providers) {
    await tx.provider.create({
      data: {
        name: p.name,
        apiBaseUrl: p.api_base_url,
        apiKey: null,
        transformer: p.transformer !== undefined ? p.transformer : Prisma.DbNull,
        models: { create: p.models.map((name) => ({ name, deprecated: isDeprecatedModel(name) })) }
      }
    })
    modelCount += p.models.length
  }
  return modelCount
}

async function migrateRouterSlots(tx: Tx, router: LegacyRouter): Promise<number> {
  let routerSlotsSet = 0
  for (const scenario of SCENARIO_KEYS) {
    const raw = router[scenario]
    const slot = parseSlot(raw)
    let modelId: string | null = null
    if (slot) {
      const m = await tx.model.findFirst({
        where: { name: slot.modelName, provider: { name: slot.providerName } }
      })
      if (m) {
        modelId = m.id
      } else {
        logger.warn(
          `[migrate] Router slot "${scenario}" referenced unknown model "${slot.providerName},${slot.modelName}" — left empty.`
        )
      }
    }
    const params: Prisma.InputJsonValue | typeof Prisma.DbNull =
      scenario === 'longContext' && typeof router.longContextThreshold === 'number'
        ? { threshold: router.longContextThreshold }
        : Prisma.DbNull
    await tx.routerSlot.update({ where: { scenario }, data: { modelId, params } })
    if (modelId) routerSlotsSet += 1
  }
  return routerSlotsSet
}

// --- Main -------------------------------------------------------------------

export async function runJsonToDbMigration(): Promise<MigrationOutcome> {
  const disk = await readDiskConfig()
  if (!disk) return { kind: 'no-config-file' }

  const rawProviders = disk.Providers !== undefined ? disk.Providers : disk.providers
  const legacyProviders: LegacyProvider[] = rawProviders !== undefined ? rawProviders : []
  const legacyRouter: LegacyRouter = disk.Router !== undefined ? disk.Router : {}
  const hasLegacyKeys = legacyProviders.length > 0 || Object.keys(legacyRouter).length > 0
  if (!hasLegacyKeys) return { kind: 'nothing-to-migrate' }

  const prisma = getPrismaClient()
  const existingRows = await prisma.provider.count()
  if (existingRows > 0) {
    logger.warn(
      `[migrate] Refusing to migrate: DB already holds ${existingRows} provider row(s) but config.json still carries Providers/Router. Resolve manually — either delete the disk copy or wipe the DB.`
    )
    return { kind: 'bail-both-populated', providerCount: legacyProviders.length, existingRows }
  }

  const backupPath = await backupConfigFile()
  if (backupPath) logger.info(`[migrate] Backed up pre-migration config to ${backupPath}`)

  const { modelCount, routerSlotsSet } = await prisma.$transaction(async (tx) => {
    await seedRouterSlots(tx)
    const mc = await migrateProviders(tx, legacyProviders)
    const rs = await migrateRouterSlots(tx, legacyRouter)
    return { modelCount: mc, routerSlotsSet: rs }
  })

  const { Providers: _p, providers: _pl, Router: _r, ...envelopeOnly } = disk
  await writeConfigFile(envelopeOnly)

  logger.info(
    `[migrate] Migrated ${legacyProviders.length} provider(s), ${modelCount} model(s), ${routerSlotsSet} router slot binding(s) into the database.`
  )
  return {
    kind: 'migrated',
    providerCount: legacyProviders.length,
    modelCount,
    routerSlotsSet
  }
}
