/**
 * Pure derivations behind the Providers screens.
 *
 * Kept out of the components so the "what does this provider actually
 * speak" logic — the part an operator reads when a request misbehaves —
 * can be reasoned about (and unit-tested) without React.
 */
import type { CatalogEntry, CatalogModel } from '@/schemas'
import type { ApiStyle, Provider, SubscriptionWire, TestStatus, Tier, TransformerWire } from './types'

export type ProviderState = 'live' | 'invalid' | 'unknown'

/** Models the operator has switched off. Mirrors the DB's Model.enabled. */
export function disabledModelsOf(p: Provider): string[] {
  const raw = p.transformer?._disabledModels
  if (!Array.isArray(raw)) return []
  return raw.filter((m): m is string => typeof m === 'string')
}

/** Deprecated models never reach the table — they cannot be routed to. */
export function listedModelsOf(p: Provider): string[] {
  const dropped = new Set(p.deprecatedModels === undefined ? [] : p.deprecatedModels)
  return p.models.filter((m) => !dropped.has(m))
}

export function enabledCountOf(p: Provider): number {
  const off = new Set(disabledModelsOf(p))
  return listedModelsOf(p).filter((m) => !off.has(m)).length
}

/**
 * Bucket a model name into one of the four Claude Code families.
 *
 * A local copy of `tierOf` in `llms/scenario-router/model-selection.ts`
 * rather than an import: that module reaches the Prisma client through
 * its neighbours, and pulling the server tree into the browser bundle to
 * read five string tests is the wrong trade. Precedence matches the
 * router — an explicit manual tier wins, name inference is the fallback —
 * so the column shows the tier the router will actually use.
 */
function inferTier(model: string): Tier | null {
  const lower = model.toLowerCase()
  if (lower.includes('fable')) return 'fable'
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return null
}

export function tierOf(p: Provider, model: string): Tier | null {
  const manual = p.modelManualTiers === undefined ? undefined : p.modelManualTiers[model]
  if (manual !== undefined) return manual
  return inferTier(model)
}

export function testStatusOf(p: Provider, model: string): TestStatus {
  const entry = p.modelTestStatus === undefined ? undefined : p.modelTestStatus[model]
  return entry === undefined ? 'unknown' : entry.status
}

export function apiStyleOf(p: Provider): ApiStyle | null {
  return p.api_style === undefined ? null : p.api_style
}

/** Per-model request-shape override. Null when the model inherits. */
export function apiStyleOverrideOf(p: Provider, model: string): ApiStyle | null {
  const over = p.modelApiStyles === undefined ? undefined : p.modelApiStyles[model]
  if (over === undefined) return null
  return over === p.api_style ? null : over
}

/**
 * Health of the provider as a whole.
 *
 * Subscription providers have an authoritative answer — the auth probe
 * result on each SubAccount. api_key providers have none: nothing checks
 * a key until something uses it, so the closest real signal is the last
 * per-model inference test. A provider nobody has tested reads `unknown`
 * rather than being optimistically called live.
 */
export function providerState(p: Provider, sub: SubscriptionWire | undefined): ProviderState {
  if (p.auth_mode === 'subscription') {
    if (sub === undefined || sub.accounts.length === 0) return 'unknown'
    if (sub.accounts.some((a) => a.authStatus === 'live')) return 'live'
    if (sub.accounts.some((a) => a.authStatus === 'invalid')) return 'invalid'
    return 'unknown'
  }
  const key = p.api_key === null ? '' : p.api_key.trim()
  if (key.length === 0) return 'unknown'
  const statuses = Object.values(p.modelTestStatus === undefined ? {} : p.modelTestStatus)
  if (statuses.some((s) => s.status === 'ok')) return 'live'
  if (statuses.some((s) => s.status === 'fail')) return 'invalid'
  return 'unknown'
}

/** `claude_max` / `codex_pro` carry a vendor prefix nobody needs to read. */
export const formatPlan = (plan: string): string => plan.replace(/^(claude|codex)_/i, '')

export function planOf(sub: SubscriptionWire | undefined): string | null {
  if (sub === undefined) return null
  const withPlan = sub.accounts.find((a) => a.plan !== null)
  if (withPlan === undefined || withPlan.plan === null) return null
  return formatPlan(withPlan.plan)
}

/** Most human-readable handle we hold for an account. */
export function accountLabel(a: { userName: string | null; userEmail: string | null; label: string }): string {
  if (a.userName !== null) return a.userName
  if (a.userEmail !== null) return a.userEmail
  return a.label
}

const KEY_BULLETS = '•'.repeat(16)

/**
 * Mask an outbound key for display.
 *
 * `$VAR` / `${VAR}` interpolation placeholders are not secrets — they are
 * the NAME of an environment variable — so they render verbatim. Anything
 * else keeps only the vendor prefix and the last four characters, which
 * is enough to tell two keys apart and not enough to use one.
 */
export function maskKey(key: string): string {
  if (key.startsWith('$')) return key
  if (key.length <= 8) return KEY_BULLETS
  const dash = key.slice(0, 12).lastIndexOf('-')
  const head = dash > 0 ? key.slice(0, dash + 1) : key.slice(0, 3)
  return `${head}${KEY_BULLETS}${key.slice(-4)}`
}

// Mirrors SUBSCRIPTION_TRANSFORMER_CHAIN in services/subscription-overlay.ts.
// Same reason as inferTier: read-only knowledge, not worth dragging the
// server module graph into the bundle for.
const SUBSCRIPTION_PIPELINE: Record<string, string[]> = {
  'claude-code': ['claude-code-oauth'],
  codex: ['openai-responses', 'codex-oauth']
}

const API_KEY_PIPELINE: Record<ApiStyle, string> = {
  anthropic: 'anthropic',
  openai_chat: 'openai',
  openai_responses: 'openai-responses',
  gemini: 'gemini'
}

/** Header the outbound request carries the credential in. */
const API_KEY_AUTH: Record<ApiStyle, string> = {
  anthropic: 'x-api-key',
  gemini: 'x-goog-api-key',
  openai_chat: 'Bearer',
  openai_responses: 'Bearer'
}

/** The transformer chain a request through this provider runs. */
export function pipelineOf(p: Provider): string[] {
  if (p.auth_mode === 'subscription') {
    const named = SUBSCRIPTION_PIPELINE[p.name]
    if (named !== undefined) return named
    // Self-hosted proxies pointed at a vendor endpoint under a
    // non-canonical name resolve by base URL, as the overlay does.
    if (p.api_base_url.includes('anthropic.com')) return SUBSCRIPTION_PIPELINE['claude-code']
    if (p.api_base_url.includes('chatgpt.com') || p.api_base_url.includes('openai.com/v1')) {
      return SUBSCRIPTION_PIPELINE.codex
    }
    return []
  }
  const style = apiStyleOf(p)
  return style === null ? [] : [API_KEY_PIPELINE[style]]
}

export function authLabelOf(p: Provider): string {
  if (p.auth_mode === 'subscription') return 'subscription (OAuth)'
  const style = apiStyleOf(p)
  return style === null ? '—' : API_KEY_AUTH[style]
}

/**
 * Path the chain's endpoint transformer posts to, read off the live
 * registry rather than hard-coded — the registry is what actually runs.
 */
export function endpointOf(p: Provider, transformers: TransformerWire[]): string | null {
  for (const name of pipelineOf(p)) {
    const found = transformers.find((t) => t.name === name)
    if (found !== undefined && found.endpoint !== null) return found.endpoint
  }
  return null
}

/**
 * Context window, in the mock's `400k` / `1M` shorthand.
 *
 * `lib/models/format-context.ts` renders an uppercase `200K`; the Rialto
 * tables use lowercase so the column reads as a magnitude rather than as
 * a unit symbol.
 */
export function fmtContext(n: number | undefined): string {
  if (n === undefined || n <= 0) return '—'
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : parseFloat(m.toFixed(2))}M`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export interface ModelRow {
  name: string
  tier: Tier | null
  contextWindow: number | undefined
  inputPer1M: number | null
  cachedInputPer1M: number | null
  outputPer1M: number | null
  apiStyleOverride: ApiStyle | null
  test: TestStatus
  enabled: boolean
  legacy: boolean
}

const catalogModelIndex = (entry: CatalogEntry | undefined): Map<string, CatalogModel> =>
  new Map(entry === undefined ? [] : entry.models.map((m) => [m.name, m]))

/**
 * One row per listed model.
 *
 * Prices come from the provider row (DB-held, scraped or backfilled) with
 * one exception: the cached-input leg is not mirrored onto Provider, so it
 * is read from the vendor catalog entry. Absent on both sides means the
 * vendor publishes no price, which the table shows as a dash.
 */
export function buildModelRows(p: Provider, catalogEntry: CatalogEntry | undefined): ModelRow[] {
  const off = new Set(disabledModelsOf(p))
  const ctx = p.modelContextWindows === undefined ? {} : p.modelContextWindows
  const prices = p.modelPrices === undefined ? {} : p.modelPrices
  const catalogModels = catalogModelIndex(catalogEntry)
  return listedModelsOf(p).map((name) => {
    const price = prices[name]
    const fromCatalog = catalogModels.get(name)
    return {
      name,
      tier: tierOf(p, name),
      contextWindow: ctx[name],
      inputPer1M: price === undefined ? null : price.inputPer1M,
      cachedInputPer1M: fromCatalog === undefined ? null : fromCatalog.cachedInputPer1M,
      outputPer1M: price === undefined ? null : price.outputPer1M,
      apiStyleOverride: apiStyleOverrideOf(p, name),
      test: testStatusOf(p, name),
      enabled: !off.has(name),
      legacy: fromCatalog === undefined ? false : fromCatalog.legacy
    }
  })
}

export interface AccountQuota {
  /** '5h' or '7d' — the window the percentage and reset belong to. */
  window: string
  pct: number
  resetAt: string | null
}

export type QuotaIndex = Map<string, AccountQuota[]>

/**
 * The quota window worth showing for one account: the weekly ceiling when
 * the collector has it, else the five-hour one. Both windows bind, but the
 * weekly is the one an operator plans around.
 */
export function quotaForAccount(index: QuotaIndex, accountId: string): AccountQuota | null {
  const mine = index.get(accountId)
  if (mine === undefined || mine.length === 0) return null
  const weekly = mine.find((q) => q.window === '7d')
  return weekly === undefined ? mine[0] : weekly
}

export function indexQuota(rows: ReadonlyArray<{ subAccountId: string } & AccountQuota>): QuotaIndex {
  const out: QuotaIndex = new Map()
  for (const row of rows) {
    const bucket = out.get(row.subAccountId)
    const entry = { window: row.window, pct: row.pct, resetAt: row.resetAt }
    if (bucket === undefined) out.set(row.subAccountId, [entry])
    else bucket.push(entry)
  }
  return out
}

/**
 * Rail-level headroom for a provider: the worst percentage across every
 * account and window it owns. A provider is as constrained as its most
 * exhausted window, so the maximum is the honest single number.
 */
export function providerQuotaPct(index: QuotaIndex, accountIds: readonly string[]): number | null {
  const pcts = accountIds.flatMap((id) => {
    const rows = index.get(id)
    return rows === undefined ? [] : rows.map((r) => r.pct)
  })
  return pcts.length === 0 ? null : Math.max(...pcts)
}
