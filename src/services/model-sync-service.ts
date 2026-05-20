/**
 * Pull live model catalogs from each vendor's /v1/models endpoint and
 * merge new ids into the corresponding Provider in the DB.
 *
 * The llm-prices snapshot we ship as a seed lags real releases (e.g.
 * claude-opus-4-7 had shipped weeks before the snapshot was cut), so
 * the UI's refresh action calls this to top up missing models without
 * the user having to wait for llm-prices to catch up.
 *
 * Only adds — never deletes. Vendors not in VENDOR_DEFAULTS, or
 * Providers with no api key, are skipped with a reason.
 */

import type { z } from '@hono/zod-openapi'
import { VENDOR_DEFAULTS } from '@/shared'
import { isDeprecatedModel } from '@/shared/data'
import { getPrismaClient } from '../db/client'
import { type RefreshOutcomeSchema, VendorModelsResponseSchema } from '../schemas/model.dto'

export type RefreshOutcome = z.infer<typeof RefreshOutcomeSchema>

const buildAuth = (
  modelsAuth: NonNullable<(typeof VENDOR_DEFAULTS)[string]['modelsAuth']>,
  apiKey: string,
  url: string
): { url: string; headers: Record<string, string> } => {
  const base: Record<string, string> = { Accept: 'application/json' }
  if (modelsAuth === 'bearer') {
    return { url, headers: { ...base, Authorization: `Bearer ${apiKey}` } }
  }
  if (modelsAuth === 'x-api-key') {
    return { url, headers: { ...base, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }
  }
  return { url: `${url}?key=${encodeURIComponent(apiKey)}`, headers: base }
}

type VendorModelsResponse = z.infer<typeof VendorModelsResponseSchema>

const extractModelIds = (data: VendorModelsResponse): string[] | null => {
  // OpenAI-compatible: { data: [{ id }] }.
  if (Array.isArray(data.data)) {
    return data.data.flatMap((m) => (typeof m.id === 'string' && m.id.length > 0 ? [m.id] : []))
  }
  // Google Gemini: { models: [{ name: "models/gemini-..." }] }.
  if (Array.isArray(data.models)) {
    return data.models.flatMap((m) => {
      if (typeof m.name !== 'string' || m.name.length === 0) return []
      return [m.name.replace(/^models\//, '')]
    })
  }
  return null
}

async function fetchVendorModels(vendor: string, apiKey: string): Promise<string[] | { error: string }> {
  const defaults = VENDOR_DEFAULTS[vendor]
  if (!defaults?.modelsEndpoint || !defaults.modelsAuth) {
    return { error: 'no models endpoint configured for this vendor' }
  }
  const { url, headers } = buildAuth(defaults.modelsAuth, apiKey, defaults.modelsEndpoint)
  const res = await fetch(url, { headers })
  if (!res.ok) return { error: `${vendor} returned HTTP ${res.status}` }
  const parsed = VendorModelsResponseSchema.safeParse(await res.json())
  if (!parsed.success) return { error: `${vendor} returned an unrecognised response shape` }
  const ids = extractModelIds(parsed.data)
  if (ids === null) return { error: `${vendor} returned an unrecognised response shape` }
  return ids
}

export async function refreshModelsForAllProviders(): Promise<RefreshOutcome[]> {
  const prisma = getPrismaClient()
  const providers = await prisma.provider.findMany({ include: { models: true } })
  const results: RefreshOutcome[] = []
  for (const p of providers) {
    if (!p.apiKey || p.apiKey.trim() === '') {
      results.push({ provider: p.name, added: [], error: 'no api key on file' })
      continue
    }
    const got = await fetchVendorModels(p.name, p.apiKey)
    if (!Array.isArray(got)) {
      results.push({ provider: p.name, added: [], error: got.error })
      continue
    }
    const existing = new Set(p.models.map((m) => m.name))
    const toAdd = got.filter((id) => !existing.has(id))
    if (toAdd.length > 0) {
      await prisma.model.createMany({
        data: toAdd.map((name) => ({ providerId: p.id, name, deprecated: isDeprecatedModel(name) })),
        skipDuplicates: true
      })
    }
    // Catch up the deprecation flag on previously-seeded rows.
    const allCurrentNames = [...existing, ...toAdd]
    const flipToDeprecated = allCurrentNames.filter(isDeprecatedModel)
    const flipToActive = allCurrentNames.filter((n) => !isDeprecatedModel(n))
    if (flipToDeprecated.length > 0) {
      await prisma.model.updateMany({
        where: { providerId: p.id, name: { in: flipToDeprecated }, deprecated: false },
        data: { deprecated: true }
      })
    }
    if (flipToActive.length > 0) {
      await prisma.model.updateMany({
        where: { providerId: p.id, name: { in: flipToActive }, deprecated: true },
        data: { deprecated: false }
      })
    }
    results.push({ provider: p.name, added: toAdd })
  }
  return results
}
