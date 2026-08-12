/**
 * Single-record provider / model CRUD helpers used by the REST API
 * routes. Each mutation runs in its own transaction, then triggers a
 * disk sync + llms-context reset so the changes take effect without a
 * server restart.
 */

import { type Provider, ProviderSchema } from '@/schemas'
import { getPrismaClient } from '../../db/client'
import { ModelTestStatus, type PrismaClient } from '../../generated/prisma/client'
import { resetLlmsContext } from '../../llms'
import { applyProviders } from './apply'
import { toProvider } from './compose'
import { syncToConfigFile } from './sync-to-disk'

export async function getProviders(prisma: PrismaClient = getPrismaClient()): Promise<Provider[]> {
  const providers = await prisma.provider.findMany({
    include: { models: true, subscriptionAccounts: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' }
  })
  return providers.map(toProvider)
}

export async function upsertProvider(incoming: Provider): Promise<{ provider: Provider; warnings: string[] }> {
  // Parse to fill in defaults (e.g. `enabled`) and to keep external
  // callers honest. ProviderSchema rejects anything off-shape — the
  // public API routes already pre-parse, this is belt-and-suspenders.
  const parsed = ProviderSchema.parse(incoming)
  const warnings: string[] = []
  const prisma = getPrismaClient()
  await prisma.$transaction(async (tx) => {
    await applyProviders(tx, [parsed], warnings)
  })
  await syncToConfigFile()
  resetLlmsContext()
  const p = await prisma.provider.findUniqueOrThrow({
    where: { name: parsed.name },
    include: { models: true, subscriptionAccounts: { orderBy: { createdAt: 'asc' } } }
  })
  return { provider: toProvider(p), warnings }
}

export async function deleteProviderByName(name: string): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.$transaction(async (tx) => {
    const p = await tx.provider.findUnique({ where: { name } })
    if (!p) throw new Error(`Provider "${name}" not found`)
    await tx.routerSlot.updateMany({
      where: { model: { providerId: p.id } },
      data: { modelId: null }
    })
    await tx.provider.delete({ where: { id: p.id } })
  })
  await syncToConfigFile()
  resetLlmsContext()
}

export async function setModelEnabled(providerName: string, modelName: string, enabled: boolean): Promise<void> {
  const prisma = getPrismaClient()
  const model = await prisma.model.findFirst({
    where: { name: modelName, provider: { name: providerName } }
  })
  if (!model) throw new Error(`Model "${modelName}" not found under provider "${providerName}"`)
  const flipped = model.enabled !== enabled
  await prisma.model.update({
    where: { id: model.id },
    data: {
      enabled,
      ...(flipped
        ? { testStatus: ModelTestStatus.unknown, testCheckedAt: null, testPassedAt: null, testError: null }
        : {})
    }
  })
  await syncToConfigFile()
  resetLlmsContext()
}

// Manual tier override for the quota-aware selector. `null` clears the
// override so tierOf(name) name-inference takes over again. Emits a
// llmsContext reset so any in-flight selector state re-reads the
// change on the next request.
export async function setModelManualTier(
  providerName: string,
  modelName: string,
  manualTier: 'fable' | 'opus' | 'sonnet' | 'haiku' | null
): Promise<void> {
  const prisma = getPrismaClient()
  const model = await prisma.model.findFirst({
    where: { name: modelName, provider: { name: providerName } }
  })
  if (!model) throw new Error(`Model "${modelName}" not found under provider "${providerName}"`)
  if (model.manualTier === manualTier) return
  await prisma.model.update({ where: { id: model.id }, data: { manualTier } })
  await syncToConfigFile()
  resetLlmsContext()
}
