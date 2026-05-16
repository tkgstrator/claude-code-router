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
import { CONFIG_FILE, SCENARIO_KEYS, type ScenarioKey } from '@ccr/shared'
import { isDeprecatedModel } from '@ccr/shared/data'
import JSON5 from 'json5'
import { Prisma } from '../generated/prisma/client'
import { backupConfigFile, writeConfigFile } from '../lib/configEnvelope'
import { getPrismaClient } from './client'

type LegacyProvider = {
  name: string
  api_base_url: string
  api_key: string
  models: string[]
  transformer?: unknown
}

type LegacyRouter = Partial<Record<ScenarioKey, string>> & {
  longContextThreshold?: number
}

type LegacyConfigOnDisk = Record<string, unknown> & {
  Providers?: LegacyProvider[]
  providers?: LegacyProvider[]
  Router?: LegacyRouter
}

export type MigrationOutcome =
  | { kind: 'no-config-file' }
  | { kind: 'nothing-to-migrate' }
  | { kind: 'bail-both-populated'; providerCount: number; existingRows: number }
  | { kind: 'migrated'; providerCount: number; modelCount: number; routerSlotsSet: number }

const log = (msg: string) => console.log(`[migrate] ${msg}`)

async function readDiskConfig(): Promise<LegacyConfigOnDisk | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8')
    return JSON5.parse(raw) as LegacyConfigOnDisk
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

const parseSlot = (raw: string | undefined) => {
  if (!raw) return null
  const [providerName, modelName] = raw.split(',')
  if (!providerName || !modelName) return null
  return { providerName: providerName.trim(), modelName: modelName.trim() }
}

export async function runJsonToDbMigration(): Promise<MigrationOutcome> {
  const disk = await readDiskConfig()
  if (!disk) return { kind: 'no-config-file' }

  const legacyProviders = (disk.Providers ?? disk.providers ?? []) as LegacyProvider[]
  const legacyRouter = (disk.Router ?? {}) as LegacyRouter
  const hasLegacyKeys = legacyProviders.length > 0 || Object.keys(legacyRouter).length > 0
  if (!hasLegacyKeys) return { kind: 'nothing-to-migrate' }

  const prisma = getPrismaClient()
  const existingRows = await prisma.provider.count()
  if (existingRows > 0) {
    log(
      `Refusing to migrate: DB already holds ${existingRows} provider row(s) but config.json still carries Providers/Router. ` +
        `Resolve manually — either delete the disk copy or wipe the DB.`
    )
    return { kind: 'bail-both-populated', providerCount: legacyProviders.length, existingRows }
  }

  const backupPath = await backupConfigFile()
  if (backupPath) log(`Backed up pre-migration config to ${backupPath}`)

  let modelCount = 0
  let routerSlotsSet = 0

  await prisma.$transaction(async (tx) => {
    // Seed the 6 slots first so the upsert below can target them by
    // scenario regardless of whether legacy router referenced them.
    await Promise.all(
      SCENARIO_KEYS.map((scenario) =>
        tx.routerSlot.upsert({
          where: { scenario },
          update: {},
          create: { scenario, modelId: null }
        })
      )
    )

    for (const p of legacyProviders) {
      const transformer = p.transformer as Prisma.InputJsonValue | undefined
      await tx.provider.create({
        data: {
          name: p.name,
          apiBaseUrl: p.api_base_url,
          apiKey: p.api_key,
          transformer: transformer ?? Prisma.DbNull,
          models: { create: p.models.map((name) => ({ name, deprecated: isDeprecatedModel(name) })) }
        }
      })
      modelCount += p.models.length
    }

    for (const scenario of SCENARIO_KEYS) {
      const slot = parseSlot(legacyRouter[scenario])
      let modelId: string | null = null
      if (slot) {
        const m = await tx.model.findFirst({
          where: { name: slot.modelName, provider: { name: slot.providerName } }
        })
        if (m) modelId = m.id
        else
          log(
            `Router slot "${scenario}" referenced unknown model "${slot.providerName},${slot.modelName}" — left empty.`
          )
      }
      const params: Prisma.InputJsonValue | typeof Prisma.DbNull =
        scenario === 'longContext' && typeof legacyRouter.longContextThreshold === 'number'
          ? { threshold: legacyRouter.longContextThreshold }
          : Prisma.DbNull
      await tx.routerSlot.update({
        where: { scenario },
        data: { modelId, params }
      })
      if (modelId) routerSlotsSet += 1
    }
  })

  // Strip the now-migrated keys from disk so the next boot's
  // readConfigFile() returns the envelope only.
  const { Providers: _p, providers: _pl, Router: _r, ...envelopeOnly } = disk
  await writeConfigFile(envelopeOnly)

  log(
    `Migrated ${legacyProviders.length} provider(s), ${modelCount} model(s), ${routerSlotsSet} router slot binding(s) into the database.`
  )
  return {
    kind: 'migrated',
    providerCount: legacyProviders.length,
    modelCount,
    routerSlotsSet
  }
}
