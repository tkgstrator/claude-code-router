/**
 * Access tokens for /v1/*.
 *
 * Replaces the single envelope APIKEY for machine traffic. Three things
 * the single key could not do, which are the reasons this exists:
 * revoke one client without cutting off the rest, attribute a request to
 * a client, and route one client differently from another.
 *
 * The plaintext is generated, returned once, and never stored — only its
 * sha256. A database read therefore cannot hand out working credentials,
 * and "show me the token again" is answered with "issue a new one".
 *
 * Verification is on the hot path of every /v1 request, so resolved
 * tokens are cached by hash. The cache holds negative results too: an
 * unauthenticated flood would otherwise be a database query per request.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import { getPrismaClient } from '../db/client'
import dayjs from '../lib/dayjs'
import { buildPriceMap, computeCosts, type PriceEntry } from './cost-service'

export interface AccessTokenRow {
  id: string
  name: string
  prefix: string
  surface: string | null
  profileKey: string | null
  lastUsedAt: string | null
  requestCount: number
  // USD spent by this token's traffic over SPEND_WINDOW_DAYS, priced
  // from the retained RequestLog rows. Null when nothing of this
  // token's traffic could be priced — no rows in the window, request
  // capture switched off, or no scraped price for the models it hit
  // (which is every subscription-auth model). Deliberately NOT a
  // lifetime figure: `requestCount` is a counter that survives log
  // retention and this is not, so pairing them would invite reading a
  // pruned window as a cheaper client.
  costUsd: number | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

/**
 * How far back the per-token spend figure looks.
 *
 * Bounded rather than lifetime for two reasons: RequestLog is pruned on
 * a retention schedule, so "lifetime" would silently mean "however much
 * history happens to be left"; and a fixed window is the only way two
 * tokens issued months apart compare on the same terms. The query rides
 * the existing `@@index([createdAt])` — there is no index on
 * accessTokenId, and this keeps one from being needed.
 */
export const SPEND_WINDOW_DAYS = 30

export interface IssuedToken {
  token: AccessTokenRow
  /** Shown once. Never recoverable — reissue is the only path back. */
  plaintext: string
}

const PREFIX = 'rialto_'
const TOKEN_BYTES = 32
const CACHE_TTL_MS = 30_000

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

// Resolved tokens keyed by hash. `null` records "no such token", so a
// flood of bad credentials costs one query per distinct value rather
// than one per request.
const cache = new LRUCache<string, { row: ResolvedToken | null }>({ max: 500, ttl: CACHE_TTL_MS })

export function invalidateTokenCache(): void {
  cache.clear()
}

export interface ResolvedToken {
  id: string
  name: string
  surface: string | null
  profileKey: string | null
}

const toWire = (
  row: {
    id: string
    name: string
    prefix: string
    surface: string | null
    profileKey: string | null
    lastUsedAt: Date | null
    requestCount: number
    expiresAt: Date | null
    revokedAt: Date | null
    createdAt: Date
  },
  costUsd: number | null = null
): AccessTokenRow => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  surface: row.surface,
  profileKey: row.profileKey,
  lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
  requestCount: row.requestCount,
  costUsd,
  expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
  revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
  createdAt: row.createdAt.toISOString()
})

/**
 * One aggregated (token, provider, model) row's worth of usage.
 *
 * Grouped in Postgres before pricing rather than priced per request:
 * `computeCosts` is linear in the token counts, so summing the counts
 * first and pricing once is exact, not an approximation — the same
 * reasoning `overview-service` documents for its spend window.
 */
export interface TokenSpendGroup {
  accessTokenId: string | null
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Total USD per access token, or null for a token whose traffic could
 * not be priced at all.
 *
 * Null and 0 are different answers and both happen: a subscription
 * provider has no per-token price, so its groups price to null and the
 * column shows "unpriced" rather than "free". A token that priced some
 * of its models and not others reports the part that priced — an
 * under-count, but the alternative is discarding a real number.
 */
export function sumSpendByToken(
  groups: readonly TokenSpendGroup[],
  priceMap: Map<string, PriceEntry>
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const group of groups) {
    if (group.accessTokenId === null) continue
    const cost = computeCosts(group, priceMap).totalCostUsd
    if (cost === null) continue
    const running = totals.get(group.accessTokenId)
    totals.set(group.accessTokenId, running === undefined ? cost : running + cost)
  }
  return totals
}

// Per-token spend over the trailing window. Two queries regardless of
// how many tokens exist: one grouped scan of the window, one price
// lookup for the distinct models it touched.
async function spendByToken(): Promise<Map<string, number>> {
  const since = dayjs().subtract(SPEND_WINDOW_DAYS, 'day').toDate()
  const groups = await getPrismaClient().requestLog.groupBy({
    by: ['accessTokenId', 'provider', 'model'],
    where: { accessTokenId: { not: null }, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true }
  })
  if (groups.length === 0) return new Map()
  const rows: TokenSpendGroup[] = groups.map((g) => ({
    accessTokenId: g.accessTokenId,
    provider: g.provider,
    model: g.model,
    inputTokens: g._sum.inputTokens === null ? 0 : g._sum.inputTokens,
    outputTokens: g._sum.outputTokens === null ? 0 : g._sum.outputTokens,
    cacheReadTokens: g._sum.cacheReadTokens === null ? 0 : g._sum.cacheReadTokens,
    cacheWriteTokens: g._sum.cacheWriteTokens === null ? 0 : g._sum.cacheWriteTokens
  }))
  const priceMap = await buildPriceMap(getPrismaClient(), [...new Set(rows.map((r) => `${r.provider}||${r.model}`))])
  return sumSpendByToken(rows, priceMap)
}

export async function listAccessTokens(): Promise<AccessTokenRow[]> {
  const [rows, spend] = await Promise.all([
    getPrismaClient().accessToken.findMany({ orderBy: { createdAt: 'desc' } }),
    spendByToken()
  ])
  return rows.map((row) => {
    const cost = spend.get(row.id)
    return toWire(row, cost === undefined ? null : cost)
  })
}

export interface IssueInput {
  name: string
  surface?: string | null
  profileKey?: string | null
  expiresAt?: string | null
}

export async function issueAccessToken(input: IssueInput): Promise<IssuedToken> {
  const plaintext = `${PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`
  const row = await getPrismaClient().accessToken.create({
    data: {
      name: input.name,
      tokenHash: sha256(plaintext),
      // Enough to tell two tokens apart in a list, not enough to use.
      prefix: plaintext.slice(0, PREFIX.length + 6),
      surface: input.surface === undefined ? null : input.surface,
      profileKey: input.profileKey === undefined ? null : input.profileKey,
      expiresAt: input.expiresAt === undefined || input.expiresAt === null ? null : new Date(input.expiresAt)
    }
  })
  invalidateTokenCache()
  return { token: toWire(row), plaintext }
}

/**
 * Mark a token unusable without deleting it, so the RequestLog rows it
 * authenticated still point at something that says whose they were.
 */
export async function revokeAccessToken(id: string): Promise<AccessTokenRow | null> {
  const row = await getPrismaClient()
    .accessToken.update({ where: { id }, data: { revokedAt: new Date() } })
    .catch(() => null)
  invalidateTokenCache()
  return row === null ? null : toWire(row)
}

export async function deleteAccessToken(id: string): Promise<boolean> {
  const done = await getPrismaClient()
    .accessToken.delete({ where: { id } })
    .then(() => true)
    .catch(() => false)
  invalidateTokenCache()
  return done
}

/**
 * Resolve a presented token, or null when it is unknown, revoked or
 * expired. Fails closed: any error resolving it is a rejection, never a
 * pass.
 */
export async function resolveAccessToken(presented: string): Promise<ResolvedToken | null> {
  if (presented.length === 0) return null
  const hash = sha256(presented)

  const cached = cache.get(hash)
  if (cached !== undefined) return cached.row

  const row = await getPrismaClient()
    .accessToken.findUnique({ where: { tokenHash: hash } })
    .catch(() => null)

  const usable =
    row !== null &&
    row.revokedAt === null &&
    (row.expiresAt === null || row.expiresAt.getTime() > Date.now()) &&
    // Constant-time compare of the digests. findUnique already matched
    // on the hash, so this guards only against a storage-layer surprise
    // — cheap enough to keep.
    timingSafeEqual(Buffer.from(row.tokenHash, 'hex'), Buffer.from(hash, 'hex'))

  const resolved: ResolvedToken | null = usable
    ? { id: row.id, name: row.name, surface: row.surface, profileKey: row.profileKey }
    : null
  cache.set(hash, { row: resolved })
  return resolved
}

/**
 * Record that a token served a request.
 *
 * Fire-and-forget on the hot path: usage statistics are never worth
 * failing or delaying a proxied call for. Writes go straight to the DB
 * rather than through the cache, which only holds identity.
 */
export function noteTokenUse(id: string): void {
  getPrismaClient()
    .accessToken.update({ where: { id }, data: { lastUsedAt: new Date(), requestCount: { increment: 1 } } })
    .catch(() => {
      // A dropped statistic is not a reason to disturb the request.
    })
}
