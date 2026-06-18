/**
 * Tests for subscription-account-sync-service — the write path for
 * OAuth credentials and the read path for the proxy hot path.
 *
 * Two halves:
 *
 *  1. Crypto (no DB, no network): decryptString edge cases and a
 *     full encrypt→store→decrypt roundtrip via the DB helpers.
 *
 *  2. DB (require HAS_DB): recordCodexOAuthAccount, recordClaudeOAuthAccount
 *     (with mocked fetchClaudeProfile), getActiveSubAccountAuth, and
 *     updateSubAccountAccessToken.
 */

import { createCipheriv, randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  decryptString,
  getActiveSubAccountAuth,
  reconcileActiveSubAccounts,
  recordClaudeOAuthAccount,
  recordCodexOAuthAccount,
  updateSubAccountAccessToken
} from '../../src/services/subscription-account-sync-service'
import { HAS_DB, resetDbTables, teardownPrisma } from '../db/helpers'

// ---------------------------------------------------------------------------
// Mock fetchClaudeProfile before any import resolves against the real service.
// ---------------------------------------------------------------------------
const fetchClaudeProfileMock = mock(async (_token: string) => ({
  account: {
    uuid: 'user-uuid-123',
    full_name: 'Test User',
    display_name: 'tuser',
    email: 'test@example.com'
  },
  organization: {
    organization_type: 'personal',
    rate_limit_tier: 'standard'
  }
}))

mock.module('../../src/services/claude-profile-service', () => ({
  fetchClaudeProfile: fetchClaudeProfileMock
}))

// ---------------------------------------------------------------------------
// Helpers shared by both halves
// ---------------------------------------------------------------------------

// 32-byte hex key (64 hex chars) — accepted as-is by encryptionKey().
const TEST_KEY_HEX = 'ab'.repeat(32)

const setTestKey = () => {
  process.env.CCR_ACCOUNT_ENCRYPTION_KEY = TEST_KEY_HEX
}

const clearTestKey = () => {
  delete process.env.CCR_ACCOUNT_ENCRYPTION_KEY
}

// Build a valid AES-256-GCM ciphertext in the iv.tag.body format that
// encryptString produces, so we can test decryptString without relying
// on the private encryptString export.
const encryptForTest = (plain: string, keyHex: string): string => {
  const key = Buffer.from(keyHex, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

// Minimal valid Codex id_token (header.payload.signature). The payload
// carries just the claims that buildCodexDiscoveredAccount reads.
const makeCodexIdToken = (overrides: Record<string, unknown> = {}): string => {
  const payload = {
    sub: 'user-sub-abc',
    name: 'Codex User',
    email: 'codex@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc-xyz',
      chatgpt_plan_type: 'plus',
      chatgpt_subscription_active_until: new Date(Date.now() + 30 * 24 * 3600_000).toISOString()
    },
    ...overrides
  }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `eyJhbGciOiJSUzI1NiJ9.${b64}.sig`
}

// ---------------------------------------------------------------------------
// 1. Crypto unit tests (no DB)
// ---------------------------------------------------------------------------

describe('decryptString', () => {
  test('returns null for null input', () => {
    setTestKey()
    expect(decryptString(null, Buffer.from(TEST_KEY_HEX, 'hex'))).toBeNull()
    clearTestKey()
  })

  test('returns null for string with wrong part count', () => {
    const key = Buffer.from(TEST_KEY_HEX, 'hex')
    expect(decryptString('only.two', key)).toBeNull()
    expect(decryptString('one', key)).toBeNull()
    expect(decryptString('a.b.c.d', key)).toBeNull()
  })

  test('returns null when auth tag is wrong (different key)', () => {
    setTestKey()
    const enc = encryptForTest('secret', TEST_KEY_HEX)
    const wrongKey = Buffer.from('cd'.repeat(32), 'hex')
    expect(decryptString(enc, wrongKey)).toBeNull()
    clearTestKey()
  })

  test('roundtrip: encrypt then decrypt returns original plaintext', () => {
    const key = Buffer.from(TEST_KEY_HEX, 'hex')
    const plain = 'sk-ant-super-secret-token'
    const enc = encryptForTest(plain, TEST_KEY_HEX)
    expect(decryptString(enc, key)).toBe(plain)
  })

  test('roundtrip is stable across multiple encryptions (different IVs)', () => {
    const key = Buffer.from(TEST_KEY_HEX, 'hex')
    const plain = 'token-value'
    // Two encryptions produce different ciphertexts (random IV) but both decrypt.
    const enc1 = encryptForTest(plain, TEST_KEY_HEX)
    const enc2 = encryptForTest(plain, TEST_KEY_HEX)
    expect(enc1).not.toBe(enc2)
    expect(decryptString(enc1, key)).toBe(plain)
    expect(decryptString(enc2, key)).toBe(plain)
  })
})

// ---------------------------------------------------------------------------
// 2. DB-backed tests
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_DB)('subscription-account-sync-service (DB)', () => {
  const prisma = () => {
    const { getPrismaClient } = require('../../src/db/client')
    return getPrismaClient()
  }

  beforeEach(async () => {
    setTestKey()
    fetchClaudeProfileMock.mockClear()
    await resetDbTables()
  })

  afterAll(async () => {
    clearTestKey()
    await teardownPrisma()
  })

  const createSubProvider = async (kind: 'claude' | 'codex') => {
    const { AuthMode } = await import('../../src/generated/prisma/client')
    const db = prisma()
    return db.provider.create({
      data: {
        name: kind === 'claude' ? 'claude-code-oauth' : 'codex-oauth',
        apiBaseUrl:
          kind === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
        authMode: AuthMode.subscription
      }
    })
  }

  // -------------------------------------------------------------------------
  // recordCodexOAuthAccount
  // -------------------------------------------------------------------------

  describe('recordCodexOAuthAccount', () => {
    test('upserts SubAccount row and sets provider active account', async () => {
      await createSubProvider('codex')
      const db = prisma()

      await recordCodexOAuthAccount({
        accessToken: 'codex-at',
        refreshToken: 'codex-rt',
        idToken: makeCodexIdToken()
      })

      const accounts = await db.subAccount.findMany()
      expect(accounts).toHaveLength(1)
      expect(accounts[0].sourcePath).toBe('oauth:codex:acc-xyz')
      expect(accounts[0].accountId).toBe('acc-xyz')
      expect(accounts[0].userId).toBe('user-sub-abc')
      // Tokens must be encrypted (not plaintext).
      expect(accounts[0].accessTokenEnc).not.toBeNull()
      expect(accounts[0].accessTokenEnc).not.toBe('codex-at')

      // Provider should have this account as active.
      const provider = await db.provider.findFirst({
        include: { activeSubscriptionAccount: true }
      })
      expect(provider?.activeSubscriptionAccount?.id).toBe(accounts[0].id)
    })

    test('decrypted tokens match originals', async () => {
      await createSubProvider('codex')
      const key = Buffer.from(TEST_KEY_HEX, 'hex')
      const db = prisma()

      await recordCodexOAuthAccount({
        accessToken: 'at-value',
        refreshToken: 'rt-value',
        idToken: makeCodexIdToken()
      })

      const row = await db.subAccount.findFirst()
      expect(row).not.toBeNull()
      expect(decryptString(row!.accessTokenEnc, key)).toBe('at-value')
      expect(decryptString(row!.refreshTokenEnc, key)).toBe('rt-value')
    })

    test('skips upsert when idToken cannot be decoded', async () => {
      await createSubProvider('codex')
      const db = prisma()

      await recordCodexOAuthAccount({
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: 'not.a.jwt'
      })

      const accounts = await db.subAccount.findMany()
      expect(accounts).toHaveLength(0)
    })

    test('skips upsert when no matching subscription provider exists', async () => {
      // No provider created — should silently skip.
      const db = prisma()

      await recordCodexOAuthAccount({
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: makeCodexIdToken()
      })

      const accounts = await db.subAccount.findMany()
      expect(accounts).toHaveLength(0)
    })

    test('second call updates the existing row (idempotent upsert)', async () => {
      await createSubProvider('codex')
      const key = Buffer.from(TEST_KEY_HEX, 'hex')
      const db = prisma()

      await recordCodexOAuthAccount({
        accessToken: 'at-v1',
        refreshToken: 'rt-v1',
        idToken: makeCodexIdToken()
      })
      await recordCodexOAuthAccount({
        accessToken: 'at-v2',
        refreshToken: 'rt-v2',
        idToken: makeCodexIdToken()
      })

      const accounts = await db.subAccount.findMany()
      expect(accounts).toHaveLength(1)
      expect(decryptString(accounts[0].accessTokenEnc, key)).toBe('at-v2')
    })
  })

  // -------------------------------------------------------------------------
  // recordClaudeOAuthAccount
  // -------------------------------------------------------------------------

  describe('recordClaudeOAuthAccount', () => {
    test('upserts SubAccount row using profile data', async () => {
      await createSubProvider('claude')
      const db = prisma()

      await recordClaudeOAuthAccount({
        accessToken: 'claude-at',
        refreshToken: 'claude-rt',
        expiresAt: Date.now() + 3600_000,
        scopes: ['read', 'write']
      })

      expect(fetchClaudeProfileMock).toHaveBeenCalledTimes(1)
      const accounts = await db.subAccount.findMany()
      expect(accounts).toHaveLength(1)
      expect(accounts[0].sourcePath).toBe('oauth:claude:user-uuid-123')
      expect(accounts[0].userId).toBe('user-uuid-123')
      expect(accounts[0].userEmail).toBe('test@example.com')
    })

    test('skips upsert when profile returns no uuid', async () => {
      fetchClaudeProfileMock.mockImplementationOnce(async () => ({
        account: { uuid: null, full_name: null, display_name: null, email: null },
        organization: null
      }))
      await createSubProvider('claude')
      const db = prisma()

      await recordClaudeOAuthAccount({
        accessToken: 'claude-at',
        refreshToken: 'claude-rt',
        expiresAt: null,
        scopes: []
      })

      const accounts = await db.subAccount.findMany()
      expect(accounts).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getActiveSubAccountAuth
  // -------------------------------------------------------------------------

  describe('getActiveSubAccountAuth', () => {
    test('returns null when no subscription provider exists', async () => {
      const result = await getActiveSubAccountAuth('nonexistent')
      expect(result).toBeNull()
    })

    test('returns null when provider has no active account', async () => {
      await createSubProvider('codex')
      const result = await getActiveSubAccountAuth('codex-oauth')
      expect(result).toBeNull()
    })

    test('returns decrypted tokens for the active account', async () => {
      await createSubProvider('codex')
      await recordCodexOAuthAccount({
        accessToken: 'live-at',
        refreshToken: 'live-rt',
        idToken: makeCodexIdToken()
      })

      const auth = await getActiveSubAccountAuth('codex-oauth')
      expect(auth).not.toBeNull()
      expect(auth!.accessToken).toBe('live-at')
      expect(auth!.refreshToken).toBe('live-rt')
      expect(auth!.accountId).toBe('acc-xyz')
      expect(auth!.subAccountId).toBeString()
    })
  })

  // -------------------------------------------------------------------------
  // updateSubAccountAccessToken
  // -------------------------------------------------------------------------

  describe('updateSubAccountAccessToken', () => {
    test('updates access token and re-encrypts', async () => {
      await createSubProvider('codex')
      await recordCodexOAuthAccount({
        accessToken: 'old-at',
        refreshToken: 'old-rt',
        idToken: makeCodexIdToken()
      })

      const before = await getActiveSubAccountAuth('codex-oauth')
      expect(before!.accessToken).toBe('old-at')

      await updateSubAccountAccessToken(before!.subAccountId, {
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        expiresAt: new Date(Date.now() + 3600_000)
      })

      const after = await getActiveSubAccountAuth('codex-oauth')
      expect(after!.accessToken).toBe('new-at')
      expect(after!.refreshToken).toBe('new-rt')
    })

    test('does not update refreshToken when omitted', async () => {
      await createSubProvider('codex')
      await recordCodexOAuthAccount({
        accessToken: 'old-at',
        refreshToken: 'keep-rt',
        idToken: makeCodexIdToken()
      })

      const before = await getActiveSubAccountAuth('codex-oauth')
      await updateSubAccountAccessToken(before!.subAccountId, { accessToken: 'new-at' })

      const after = await getActiveSubAccountAuth('codex-oauth')
      expect(after!.accessToken).toBe('new-at')
      expect(after!.refreshToken).toBe('keep-rt')
    })
  })

  // -------------------------------------------------------------------------
  // reconcileActiveSubAccounts — boot-time self-heal for providers whose
  // active-account binding was orphaned by older toggle code that nulled
  // it without promoting a successor.
  // -------------------------------------------------------------------------

  describe('reconcileActiveSubAccounts', () => {
    const seedAccount = async (providerId: string, sourcePath: string, enabled: boolean) => {
      const db = prisma()
      return db.subAccount.create({
        data: {
          providerId,
          sourcePath,
          label: `claude-code:${sourcePath}`,
          enabled,
          userName: 'Tester',
          userEmail: `${sourcePath}@example.com`,
          plan: 'claude_max'
        }
      })
    }

    test('promotes oldest enabled account when active binding is null', async () => {
      const provider = await createSubProvider('claude')
      const db = prisma()
      // Mirror the bug case: a disabled "old" account, an enabled "new"
      // one, and no active binding.
      await seedAccount(provider.id, 'oauth:claude:disabled', false)
      const enabled = await seedAccount(provider.id, 'oauth:claude:enabled', true)

      await reconcileActiveSubAccounts()

      const after = await db.provider.findUnique({
        where: { id: provider.id },
        select: { activeSubscriptionAccountId: true }
      })
      expect(after?.activeSubscriptionAccountId).toBe(enabled.id)
    })

    test('promotes when active points at a now-disabled account', async () => {
      const provider = await createSubProvider('claude')
      const db = prisma()
      const stale = await seedAccount(provider.id, 'oauth:claude:stale', false)
      const fresh = await seedAccount(provider.id, 'oauth:claude:fresh', true)
      await db.provider.update({
        where: { id: provider.id },
        data: { activeSubscriptionAccountId: stale.id }
      })

      await reconcileActiveSubAccounts()

      const after = await db.provider.findUnique({
        where: { id: provider.id },
        select: { activeSubscriptionAccountId: true }
      })
      expect(after?.activeSubscriptionAccountId).toBe(fresh.id)
    })

    test('leaves binding null when no enabled account is available', async () => {
      const provider = await createSubProvider('claude')
      const db = prisma()
      await seedAccount(provider.id, 'oauth:claude:only', false)

      await reconcileActiveSubAccounts()

      const after = await db.provider.findUnique({
        where: { id: provider.id },
        select: { activeSubscriptionAccountId: true }
      })
      expect(after?.activeSubscriptionAccountId).toBeNull()
    })

    test('leaves a healthy active binding untouched', async () => {
      const provider = await createSubProvider('claude')
      const db = prisma()
      const live = await seedAccount(provider.id, 'oauth:claude:live', true)
      await seedAccount(provider.id, 'oauth:claude:other', true)
      await db.provider.update({
        where: { id: provider.id },
        data: { activeSubscriptionAccountId: live.id }
      })

      await reconcileActiveSubAccounts()

      const after = await db.provider.findUnique({
        where: { id: provider.id },
        select: { activeSubscriptionAccountId: true }
      })
      expect(after?.activeSubscriptionAccountId).toBe(live.id)
    })
  })
})
