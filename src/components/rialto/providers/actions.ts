/**
 * Mutations the Providers screens issue.
 *
 * All of them go through `POST /api/providers`, which upserts by name —
 * the PATCH and DELETE verbs on the CRUD routes are not reachable from
 * the browser client, and the full-config round trip is the sanctioned
 * path for a delete (its diff clears the RouterSlot bindings that would
 * otherwise abort the transaction).
 */
import { api } from '@/lib/api'
import { setModelDisabled } from '@/lib/providers/provider-edits'
import type { ModelTestResponse, Provider } from './types'

/** Flip one model on or off. `_disabledModels` is the wire view of Model.enabled. */
export async function toggleModel(provider: Provider, model: string, next: boolean): Promise<void> {
  await api.post('/providers', setModelDisabled(provider, model, !next))
}

export async function saveApiKey(provider: Provider, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  await api.post('/providers', { ...provider, api_key: trimmed === '' ? null : trimmed })
}

/**
 * Remove a provider by writing the config back without it. `applyUiConfig`
 * deletes anything the payload no longer lists.
 */
export async function removeProvider(name: string): Promise<void> {
  const config = await api.getConfig()
  await api.updateConfig({ ...config, Providers: config.Providers.filter((p) => p.name !== name) })
}

/**
 * Probe every enabled model, one at a time.
 *
 * There is no provider-scoped batch endpoint — `/api/models/test-all`
 * covers the whole install — and each probe is a real inference call, so
 * serialising them keeps a "Test all" on an 18-model vendor from opening
 * eighteen concurrent upstream requests. A rejected probe is a result,
 * not an error: the outcome is already persisted on the Model row.
 */
export async function testModels(providerName: string, models: string[]): Promise<void> {
  for (const model of models) {
    await api.post<ModelTestResponse>('/models/test', { provider: providerName, model }).catch(() => null)
  }
}

/** Re-read the vendor's model list onto every configured provider. */
export async function syncModels(): Promise<void> {
  await api.post('/refresh-models', {})
}

/** Re-scrape vendor pricing pages, then reflect fresh prices onto provider rows. */
export async function refreshPrices(): Promise<void> {
  await api.post('/catalog/refresh', {})
  await api.post('/refresh-models', {})
}
