/**
 * Unit tests for OauthTransformerBase — the shared scaffolding behind
 * claude-code-oauth and codex-oauth.
 *
 * Two contracts the base class guarantees, and every concrete subclass
 * relies on:
 *
 *  1. Credential file path: honour `provider.transformer.subscriptionCredentialPath`
 *     when it is a non-empty string; fall back to the subclass's
 *     defaultCredentialPath otherwise (incl. empty string / non-string /
 *     missing).
 *  2. Token source: prefer `provider.transformer.subscriptionAuth.accessToken`
 *     when it is a non-empty string (the DB-synced token kept current by
 *     the subscription-account-sync service); otherwise call readFromDisk
 *     with the resolved path. accountId is only honoured alongside a
 *     real DB token.
 */

import { describe, expect, test } from 'bun:test'
import { type OauthCredentials, OauthTransformerBase } from '../../src/vendor/llms/transformer/oauth-base'

const DEFAULT_PATH = '/default/creds.json'

// Stand-in subclass: records each readFromDisk call so we can assert on
// (a) WHETHER disk was read at all and (b) WHICH path was used. Exposes
// the two protected helpers via plain wrappers so tests can drive them
// directly without leaning on `as any`.
class TestTransformer extends OauthTransformerBase {
  name = 'test-oauth'
  protected defaultCredentialPath = DEFAULT_PATH
  readCalls: string[] = []
  diskResult: OauthCredentials = { token: 'disk-token', accountId: 'disk-account' }

  protected async readFromDisk(path: string): Promise<OauthCredentials> {
    this.readCalls.push(path)
    return this.diskResult
  }

  resolvePath(provider: unknown): string {
    return this.resolveCredentialsPath(provider)
  }

  resolveAuth(provider: unknown): Promise<OauthCredentials> {
    return this.resolveSubscriptionAuth(provider)
  }
}

describe('OauthTransformerBase.resolveCredentialsPath', () => {
  test('uses override when subscriptionCredentialPath is a non-empty string', () => {
    const t = new TestTransformer()
    expect(t.resolvePath({ transformer: { subscriptionCredentialPath: '/custom/creds.json' } })).toBe(
      '/custom/creds.json'
    )
  })

  test('falls back to default when subscriptionCredentialPath is missing', () => {
    const t = new TestTransformer()
    expect(t.resolvePath({ transformer: {} })).toBe(DEFAULT_PATH)
  })

  test('falls back to default when subscriptionCredentialPath is an empty string', () => {
    const t = new TestTransformer()
    expect(t.resolvePath({ transformer: { subscriptionCredentialPath: '' } })).toBe(DEFAULT_PATH)
  })

  test('falls back to default when subscriptionCredentialPath is not a string', () => {
    const t = new TestTransformer()
    expect(t.resolvePath({ transformer: { subscriptionCredentialPath: 42 } })).toBe(DEFAULT_PATH)
    expect(t.resolvePath({ transformer: { subscriptionCredentialPath: null } })).toBe(DEFAULT_PATH)
    expect(t.resolvePath({ transformer: { subscriptionCredentialPath: { nested: true } } })).toBe(DEFAULT_PATH)
  })

  test('falls back to default when provider / transformer is undefined', () => {
    const t = new TestTransformer()
    expect(t.resolvePath(undefined)).toBe(DEFAULT_PATH)
    expect(t.resolvePath(null)).toBe(DEFAULT_PATH)
    expect(t.resolvePath({})).toBe(DEFAULT_PATH)
  })
})

describe('OauthTransformerBase.resolveSubscriptionAuth — DB token path', () => {
  test('returns the DB token + accountId when both are non-empty strings', async () => {
    const t = new TestTransformer()
    const result = await t.resolveAuth({
      transformer: { subscriptionAuth: { accessToken: 'db-token', accountId: 'db-account' } }
    })
    expect(result).toEqual({ token: 'db-token', accountId: 'db-account' })
    expect(t.readCalls).toEqual([])
  })

  test('returns the DB token with undefined accountId when DB accountId is missing', async () => {
    const t = new TestTransformer()
    const result = await t.resolveAuth({
      transformer: { subscriptionAuth: { accessToken: 'db-token' } }
    })
    expect(result).toEqual({ token: 'db-token', accountId: undefined })
    expect(t.readCalls).toEqual([])
  })

  test('ignores a non-string DB accountId (treats it as absent)', async () => {
    const t = new TestTransformer()
    const result = await t.resolveAuth({
      transformer: { subscriptionAuth: { accessToken: 'db-token', accountId: 12345 } }
    })
    expect(result).toEqual({ token: 'db-token', accountId: undefined })
  })
})

describe('OauthTransformerBase.resolveSubscriptionAuth — disk fallback', () => {
  test('falls back to readFromDisk when no DB token is set', async () => {
    const t = new TestTransformer()
    const result = await t.resolveAuth({ transformer: {} })
    expect(result).toEqual({ token: 'disk-token', accountId: 'disk-account' })
    expect(t.readCalls).toEqual([DEFAULT_PATH])
  })

  test('falls back to disk when DB token is an empty string', async () => {
    const t = new TestTransformer()
    const result = await t.resolveAuth({
      transformer: { subscriptionAuth: { accessToken: '', accountId: 'db-account' } }
    })
    expect(result).toEqual({ token: 'disk-token', accountId: 'disk-account' })
    expect(t.readCalls).toEqual([DEFAULT_PATH])
  })

  test('falls back to disk when DB accessToken is not a string', async () => {
    const t = new TestTransformer()
    const result = await t.resolveAuth({
      transformer: { subscriptionAuth: { accessToken: null } }
    })
    expect(result).toEqual({ token: 'disk-token', accountId: 'disk-account' })
    expect(t.readCalls).toEqual([DEFAULT_PATH])
  })

  test('falls back to disk when provider is undefined', async () => {
    const t = new TestTransformer()
    const result = await t.resolveAuth(undefined)
    expect(result).toEqual({ token: 'disk-token', accountId: 'disk-account' })
    expect(t.readCalls).toEqual([DEFAULT_PATH])
  })

  test('passes the override path to readFromDisk when subscriptionCredentialPath is set', async () => {
    const t = new TestTransformer()
    await t.resolveAuth({ transformer: { subscriptionCredentialPath: '/custom/creds.json' } })
    expect(t.readCalls).toEqual(['/custom/creds.json'])
  })

  test('disk fallback returns whatever readFromDisk yields (no accountId case)', async () => {
    const t = new TestTransformer()
    t.diskResult = { token: 'disk-only-token' }
    const result = await t.resolveAuth({ transformer: {} })
    expect(result).toEqual({ token: 'disk-only-token' })
    expect(result.accountId).toBeUndefined()
  })
})
