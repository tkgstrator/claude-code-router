/**
 * Access tokens.
 *
 * This is the credential store for the billable proxy, so the
 * properties worth pinning are the ones whose failure hands someone
 * else's traffic away: the plaintext must not be recoverable, a revoked
 * or expired token must stop working, and a token pinned to a surface
 * must not resolve as unscoped.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { getPrismaClient } from '../../src/db/client'
import {
  deleteAccessToken,
  invalidateTokenCache,
  issueAccessToken,
  listAccessTokens,
  resolveAccessToken,
  revokeAccessToken
} from '../../src/services/access-token-service'
import { HAS_DB, resetDbTables, teardownPrisma } from './helpers'

describe.skipIf(!HAS_DB)('access-token-service', () => {
  beforeEach(async () => {
    await resetDbTables()
    await getPrismaClient().accessToken.deleteMany({})
    invalidateTokenCache()
  })

  afterAll(teardownPrisma)

  test('the plaintext is returned once and never stored', async () => {
    const { token, plaintext } = await issueAccessToken({ name: 'ci' })
    const stored = await getPrismaClient().accessToken.findUnique({ where: { id: token.id } })

    expect(plaintext.startsWith('rialto_')).toBe(true)
    // The row must not contain the secret in any form a reader could use.
    expect(JSON.stringify(stored)).not.toContain(plaintext)
    expect(stored?.tokenHash).not.toBe(plaintext)
  })

  test('the listed prefix identifies a token without being usable as one', async () => {
    const { token, plaintext } = await issueAccessToken({ name: 'ci' })
    expect(plaintext.startsWith(token.prefix)).toBe(true)
    expect(token.prefix.length).toBeLessThan(plaintext.length)
    expect(await resolveAccessToken(token.prefix)).toBeNull()
  })

  test('a freshly issued token resolves with its scope', async () => {
    const { plaintext } = await issueAccessToken({ name: 'ci', surface: 'openai-chat', profileKey: 'cost-first' })
    const resolved = await resolveAccessToken(plaintext)
    expect(resolved?.name).toBe('ci')
    expect(resolved?.surface).toBe('openai-chat')
    expect(resolved?.profileKey).toBe('cost-first')
  })

  test('an unscoped token resolves with nulls rather than defaults', async () => {
    const { plaintext } = await issueAccessToken({ name: 'anything' })
    const resolved = await resolveAccessToken(plaintext)
    expect(resolved?.surface).toBeNull()
    expect(resolved?.profileKey).toBeNull()
  })

  test('a revoked token stops resolving but stays listed', async () => {
    const { token, plaintext } = await issueAccessToken({ name: 'leaked' })
    await revokeAccessToken(token.id)

    expect(await resolveAccessToken(plaintext)).toBeNull()
    // Revoke keeps the row so past requests still say whose they were.
    const listed = await listAccessTokens()
    expect(listed).toHaveLength(1)
    expect(listed[0].revokedAt).not.toBeNull()
  })

  test('an expired token stops resolving', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const { plaintext } = await issueAccessToken({ name: 'old', expiresAt: past })
    expect(await resolveAccessToken(plaintext)).toBeNull()
  })

  test('a token expiring in the future still resolves', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const { plaintext } = await issueAccessToken({ name: 'valid', expiresAt: future })
    expect(await resolveAccessToken(plaintext)).not.toBeNull()
  })

  test('an unknown value never resolves', async () => {
    expect(await resolveAccessToken('rialto_deadbeef')).toBeNull()
    expect(await resolveAccessToken('')).toBeNull()
  })

  test('two tokens are distinct credentials', async () => {
    const a = await issueAccessToken({ name: 'a' })
    const b = await issueAccessToken({ name: 'b' })
    expect(a.plaintext).not.toBe(b.plaintext)
    expect((await resolveAccessToken(a.plaintext))?.name).toBe('a')
    expect((await resolveAccessToken(b.plaintext))?.name).toBe('b')
  })

  test('revocation takes effect immediately despite the hot-path cache', async () => {
    const { token, plaintext } = await issueAccessToken({ name: 'ci' })
    // Prime the cache the way a real request would.
    expect(await resolveAccessToken(plaintext)).not.toBeNull()
    await revokeAccessToken(token.id)
    expect(await resolveAccessToken(plaintext)).toBeNull()
  })

  test('deletion also takes effect immediately', async () => {
    const { token, plaintext } = await issueAccessToken({ name: 'ci' })
    expect(await resolveAccessToken(plaintext)).not.toBeNull()
    expect(await deleteAccessToken(token.id)).toBe(true)
    expect(await resolveAccessToken(plaintext)).toBeNull()
    expect(await listAccessTokens()).toHaveLength(0)
  })
})
