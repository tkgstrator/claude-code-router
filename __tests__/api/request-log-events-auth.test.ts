/**
 * The live-updates stream authenticates like every other /api route.
 *
 * It used to carry its own inline check against the envelope key,
 * because EventSource cannot set headers and the credential arrives as a
 * query parameter. That copy knew nothing about the local exemption or
 * Cloudflare Access, so on a machine where every other /api call
 * succeeded, live updates alone returned 401 — and it would have broken
 * outright once the bootstrap token stopped being minted.
 *
 * `adminAuth` already permits the `apikey` parameter on this one path,
 * so the stream carries no gate of its own. These tests pin that it is
 * still gated, by the shared one.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { adminAuth } from '../../src/api/api-key-auth'
import { requestLogsRoute } from '../../src/api/request-logs/route'

const BOOTSTRAP = 'bootstrap-key-for-events'
const PATH = '/api/request-logs/events'
const saved = { key: process.env.APIKEY, trust: process.env.RIALTO_TRUST_LOCAL }

function buildApp(): Hono {
  const app = new Hono()
  app.use('/api/*', adminAuth)
  app.route('/', requestLogsRoute)
  return app
}

// The handler answers with an open stream, so anything that is not a 401
// means the request got through. Aborting keeps the stream from holding
// the test open.
async function status(url: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await buildApp().fetch(new Request(`http://local${url}`, { headers }))
  await res.body?.cancel()
  return res.status
}

beforeEach(() => {
  process.env.APIKEY = BOOTSTRAP
  delete process.env.RIALTO_TRUST_LOCAL
})

afterEach(() => {
  if (saved.key === undefined) delete process.env.APIKEY
  else process.env.APIKEY = saved.key
  if (saved.trust === undefined) delete process.env.RIALTO_TRUST_LOCAL
  else process.env.RIALTO_TRUST_LOCAL = saved.trust
})

describe('GET /api/request-logs/events', () => {
  test('opens for a browser on this machine, with no credential', async () => {
    // The regression: this returned 401 while every sibling route
    // returned 200 on the same host.
    expect(await status(PATH, { host: 'localhost:16175' })).not.toBe(401)
  })

  test('accepts the credential as a query parameter, since EventSource cannot send headers', async () => {
    expect(await status(`${PATH}?apikey=${BOOTSTRAP}`, { host: 'rialto.example.com' })).not.toBe(401)
  })

  test('rejects a remote request with no credential', async () => {
    expect(await status(PATH, { host: 'rialto.example.com' })).toBe(401)
  })

  test('rejects a wrong query parameter', async () => {
    expect(await status(`${PATH}?apikey=nope`, { host: 'rialto.example.com' })).toBe(401)
  })

  test('a tunnelled request is not local even when the Host says localhost', async () => {
    expect(await status(PATH, { host: 'localhost:16175', 'cf-connecting-ip': '203.0.113.7' })).toBe(401)
  })

  test('is still gated when no bootstrap token is configured at all', async () => {
    // The default after this change: nothing to fall back to, so remote
    // access depends entirely on Access.
    delete process.env.APIKEY
    expect(await status(PATH, { host: 'rialto.example.com' })).toBe(401)
    expect(await status(`${PATH}?apikey=anything`, { host: 'rialto.example.com' })).toBe(401)
    // ...and a local browser still gets through, which is the point.
    expect(await status(PATH, { host: 'localhost:16175' })).not.toBe(401)
  })
})
