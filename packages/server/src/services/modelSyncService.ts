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

import { VENDOR_DEFAULTS } from '@ccr/shared'
import { getPrismaClient } from '../db/client'

export interface RefreshOutcome {
  provider: string
  added: string[]
  error?: string
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: unknown }>
}

interface GoogleModelsResponse {
  models?: Array<{ name?: unknown }>
}

async function fetchVendorModels(vendor: string, apiKey: string): Promise<string[] | { error: string }> {
  const defaults = VENDOR_DEFAULTS[vendor]
  if (!defaults?.modelsEndpoint || !defaults.modelsAuth) {
    return { error: 'no models endpoint configured for this vendor' }
  }
  const headers: Record<string, string> = { Accept: 'application/json' }
  let url = defaults.modelsEndpoint
  if (defaults.modelsAuth === 'bearer') {
    headers.Authorization = `Bearer ${apiKey}`
  } else if (defaults.modelsAuth === 'x-api-key') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (defaults.modelsAuth === 'google-key-param') {
    url += `?key=${encodeURIComponent(apiKey)}`
  }
  const res = await fetch(url, { headers })
  if (!res.ok) return { error: `${vendor} returned HTTP ${res.status}` }
  const data = (await res.json()) as OpenAiModelsResponse & GoogleModelsResponse
  // OpenAI-compatible: { data: [{ id }] }
  if (Array.isArray(data.data)) {
    return data.data.map((m) => String(m.id ?? '')).filter((id) => id.length > 0)
  }
  // Google Gemini: { models: [{ name: "models/gemini-..." }] }
  if (Array.isArray(data.models)) {
    return data.models.map((m) => String(m.name ?? '').replace(/^models\//, '')).filter((id) => id.length > 0)
  }
  return { error: `${vendor} returned an unrecognised response shape` }
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
        data: toAdd.map((name) => ({ providerId: p.id, name })),
        skipDuplicates: true
      })
    }
    results.push({ provider: p.name, added: toAdd })
  }
  return results
}
