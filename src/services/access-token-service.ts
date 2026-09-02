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

export interface AccessTokenRow {
  id: string
  name: string
  prefix: string
  surface: string | null
  profileKey: string | null
  lastUsedAt: string | null
  requestCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

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

const toWire = (row: {
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
}): AccessTokenRow => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  surface: row.surface,
  profileKey: row.profileKey,
  lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
  requestCount: row.requestCount,
  expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
  revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
  createdAt: row.createdAt.toISOString()
})

export async function listAccessTokens(): Promise<AccessTokenRow[]> {
  const rows = await getPrismaClient().accessToken.findMany({ orderBy: { createdAt: 'desc' } })
  return rows.map(toWire)
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
