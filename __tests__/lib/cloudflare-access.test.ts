/**
 * Access assertion verification.
 *
 * Every test here describes a way someone could get in who should not.
 * The audience check is the one most easily left out and the most
 * costly to omit: without it, any Access application on the same team
 * mints tokens this origin would accept.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createSign, generateKeyPairSync } from 'node:crypto'
import {
  normalizeTeamDomain,
  readAccessConfig,
  resetAccessKeyCache,
  verifyAccessJwt
} from '../../src/services/cloudflare-access'

const TEAM = 'example.cloudflareaccess.com'
const AUD = 'aud-tag-for-this-app'
const CONFIG = { teamDomain: TEAM, aud: AUD }

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })

const jwk = publicKey.export({ format: 'jwk' })
const KID = 'test-kid'

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

function sign(claims: Record<string, unknown>, key = privateKey, header: Record<string, unknown> = {}): string {
  const head = b64url({ alg: 'RS256', kid: KID, ...header })
  const body = b64url(claims)
  const signer = createSign('RSA-SHA256')
  signer.update(`${head}.${body}`)
  signer.end()
  return `${head}.${body}.${signer.sign(key).toString('base64url')}`
}

const validClaims = () => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  exp: Math.floor(Date.now() / 1000) + 600,
  email: 'operator@example.com',
  sub: 'user-1'
})

const originalFetch = globalThis.fetch

beforeEach(() => {
  resetAccessKeyCache()
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url.toString()
    if (href.includes('/cdn-cgi/access/certs')) {
      return new Response(JSON.stringify({ keys: [{ kid: KID, kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' }] }), {
        headers: { 'content-type': 'application/json' }
      })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('verifyAccessJwt', () => {
  test('accepts an assertion signed by the team key for this audience', async () => {
    const identity = await verifyAccessJwt(sign(validClaims()), CONFIG)
    expect(identity?.email).toBe('operator@example.com')
    expect(identity?.subject).toBe('user-1')
  })

  test('rejects a token minted for a different application on the same team', async () => {
    // The whole point of checking aud: this signature is genuine and the
    // issuer is right, but the token was not issued for this app.
    const claims = { ...validClaims(), aud: ['some-other-app'] }
    expect(await verifyAccessJwt(sign(claims), CONFIG)).toBeNull()
  })

  test('rejects a token from a different team', async () => {
    const claims = { ...validClaims(), iss: 'https://attacker.cloudflareaccess.com' }
    expect(await verifyAccessJwt(sign(claims), CONFIG)).toBeNull()
  })

  test('rejects a signature made with a key the team never published', async () => {
    expect(await verifyAccessJwt(sign(validClaims(), other.privateKey), CONFIG)).toBeNull()
  })

  test('rejects an expired assertion', async () => {
    const claims = { ...validClaims(), exp: Math.floor(Date.now() / 1000) - 1 }
    expect(await verifyAccessJwt(sign(claims), CONFIG)).toBeNull()
  })

  test('rejects a payload whose signature does not cover it', async () => {
    // Swap the payload after signing — the classic tampering attempt.
    const token = sign(validClaims())
    const [head, , sig] = token.split('.')
    const forged = `${head}.${b64url({ ...validClaims(), email: 'attacker@example.com' })}.${sig}`
    expect(await verifyAccessJwt(forged, CONFIG)).toBeNull()
  })

  test('rejects an unsigned "alg: none" token', async () => {
    const head = b64url({ alg: 'none', kid: KID })
    const body = b64url(validClaims())
    expect(await verifyAccessJwt(`${head}.${body}.`, CONFIG)).toBeNull()
  })

  test('rejects a token signed with an unknown key id', async () => {
    expect(await verifyAccessJwt(sign(validClaims(), privateKey, { kid: 'not-published' }), CONFIG)).toBeNull()
  })

  test('rejects malformed input rather than throwing', async () => {
    expect(await verifyAccessJwt('', CONFIG)).toBeNull()
    expect(await verifyAccessJwt('not.a.jwt', CONFIG)).toBeNull()
    expect(await verifyAccessJwt('onlyonepart', CONFIG)).toBeNull()
  })

  test('rejects everything when the JWKS cannot be fetched', async () => {
    globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch
    resetAccessKeyCache()
    // Fail closed: an unreachable identity provider is not a reason to
    // let a request through.
    expect(await verifyAccessJwt(sign(validClaims()), CONFIG)).toBeNull()
  })

  test('accepts a bare-string aud as well as an array', async () => {
    expect(await verifyAccessJwt(sign({ ...validClaims(), aud: AUD }), CONFIG)).not.toBeNull()
  })
})

describe('readAccessConfig', () => {
  const saved = { domain: process.env.ACCESS_TEAM_DOMAIN, aud: process.env.ACCESS_AUD }

  afterEach(() => {
    if (saved.domain === undefined) delete process.env.ACCESS_TEAM_DOMAIN
    else process.env.ACCESS_TEAM_DOMAIN = saved.domain
    if (saved.aud === undefined) delete process.env.ACCESS_AUD
    else process.env.ACCESS_AUD = saved.aud
  })

  test('a half configuration authenticates nothing', async () => {
    // Verifying a signature without checking the audience would accept
    // every app on the team, so one value alone must not enable Access.
    process.env.ACCESS_TEAM_DOMAIN = TEAM
    delete process.env.ACCESS_AUD
    expect(readAccessConfig()).toBeNull()

    delete process.env.ACCESS_TEAM_DOMAIN
    process.env.ACCESS_AUD = AUD
    expect(readAccessConfig()).toBeNull()
  })

  test('both values present enables it, with a trailing slash tolerated', async () => {
    process.env.ACCESS_TEAM_DOMAIN = `${TEAM}/`
    process.env.ACCESS_AUD = AUD
    expect(readAccessConfig()).toEqual({ teamDomain: TEAM, aud: AUD })
  })

  test('a domain pasted with its scheme still resolves to the bare host', async () => {
    // The lockout this guards: `https://https://team…/cdn-cgi/access/certs`
    // fetches nothing and the `iss` comparison never matches, so every
    // admin request is rejected with no way back through the browser.
    process.env.ACCESS_TEAM_DOMAIN = `https://${TEAM}/`
    process.env.ACCESS_AUD = AUD
    expect(readAccessConfig()).toEqual({ teamDomain: TEAM, aud: AUD })
  })

  test('whitespace alone does not count as configured', async () => {
    process.env.ACCESS_TEAM_DOMAIN = '   '
    process.env.ACCESS_AUD = AUD
    expect(readAccessConfig()).toBeNull()
  })
})

describe('normalizeTeamDomain', () => {
  test('reduces every plausible way of typing the domain to one host', () => {
    for (const input of [TEAM, `${TEAM}/`, `https://${TEAM}`, `https://${TEAM}/`, `  HTTPS://${TEAM}  `]) {
      // The check endpoint and the runtime both call this, so a value
      // that verifies before saving is the value that runs afterwards.
      expect(normalizeTeamDomain(input).toLowerCase()).toBe(TEAM)
    }
  })
})
