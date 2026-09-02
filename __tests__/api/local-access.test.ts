/**
 * Which requests count as local.
 *
 * The failure that matters is not "a local browser had to sign in". It
 * is the opposite: cloudflared runs on the same host and proxies to
 * 127.0.0.1, so with a tunnel in front every request from the public
 * internet reaches the origin from loopback. A test that trusted the
 * peer address would publish the admin API the moment the operator set
 * up their tunnel — so most of what is pinned here is requests that
 * must NOT be treated as local.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { isLocalRequest } from '../../src/api/local-access'

// Run the predicate inside a real Hono request so header access matches
// production rather than a hand-rolled stub.
async function check(headers: Record<string, string>): Promise<boolean> {
  const app = new Hono()
  const seen = { value: false }
  app.get('/probe', (c) => {
    seen.value = isLocalRequest(c)
    return c.text('ok')
  })
  await app.fetch(new Request('http://ignored/probe', { headers }))
  return seen.value
}

const saved = process.env.RIALTO_TRUST_LOCAL

afterEach(() => {
  if (saved === undefined) delete process.env.RIALTO_TRUST_LOCAL
  else process.env.RIALTO_TRUST_LOCAL = saved
})

describe('isLocalRequest — treated as local', () => {
  test('a browser on the machine, by name or by address', async () => {
    expect(await check({ host: 'localhost:16175' })).toBe(true)
    expect(await check({ host: '127.0.0.1:3456' })).toBe(true)
    expect(await check({ host: 'localhost' })).toBe(true)
    expect(await check({ host: '[::1]:3456' })).toBe(true)
  })

  test('host matching is case-insensitive', async () => {
    expect(await check({ host: 'LOCALHOST:16175' })).toBe(true)
  })
})

describe('isLocalRequest — must not be treated as local', () => {
  test('a tunnelled request, even though it reaches the origin from loopback', async () => {
    // The whole point. cloudflared preserves the public Host, and
    // Cloudflare adds its own headers; either alone is disqualifying.
    expect(await check({ host: 'rialto.example.com' })).toBe(false)
    expect(await check({ host: 'localhost:16175', 'cf-connecting-ip': '203.0.113.7' })).toBe(false)
    expect(await check({ host: 'localhost:16175', 'cf-ray': '8f0e1d2c3b4a5678-NRT' })).toBe(false)
  })

  test('a request carrying an Access assertion is being authenticated, not exempted', async () => {
    expect(await check({ host: 'localhost:16175', 'cf-access-jwt-assertion': 'ey...' })).toBe(false)
  })

  test('anything relayed by a reverse proxy', async () => {
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded']) {
      expect(await check({ host: 'localhost:16175', [header]: 'anything' })).toBe(false)
    }
  })

  test('a LAN address is not loopback', async () => {
    expect(await check({ host: '192.168.1.20:3456' })).toBe(false)
    expect(await check({ host: '10.0.0.5' })).toBe(false)
    // 0.0.0.0 is a bind address, never a host someone legitimately
    // browses to — and treating it as local would trust anything that
    // reached a wildcard-bound port.
    expect(await check({ host: '0.0.0.0:3456' })).toBe(false)
  })

  test('a hostname that merely starts with a loopback name', async () => {
    expect(await check({ host: 'localhost.evil.example.com' })).toBe(false)
    expect(await check({ host: '127.0.0.1.evil.example.com' })).toBe(false)
  })

  test('no Host header at all', async () => {
    expect(await check({})).toBe(false)
  })

  test('an empty forwarding header does not disqualify, but an empty Host does', async () => {
    expect(await check({ host: 'localhost:16175', 'x-real-ip': '' })).toBe(true)
    expect(await check({ host: '' })).toBe(false)
  })
})

describe('the opt-out', () => {
  test('RIALTO_TRUST_LOCAL=false requires a credential even on loopback', async () => {
    process.env.RIALTO_TRUST_LOCAL = 'false'
    expect(await check({ host: 'localhost:16175' })).toBe(false)
  })

  test('any other value leaves the exemption on', async () => {
    process.env.RIALTO_TRUST_LOCAL = 'true'
    expect(await check({ host: 'localhost:16175' })).toBe(true)
  })
})
