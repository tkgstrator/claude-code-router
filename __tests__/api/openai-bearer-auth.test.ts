/**
 * The Bearer-only auth variant used on /v1/chat/completions,
 * /v1/responses, and /v1/models. Verifies the wire contract we
 * promised OpenAI clients:
 *
 *   - Authorization: Bearer <APIKEY>  → passes
 *   - x-api-key: <APIKEY>            → rejected (Anthropic convention)
 *   - wrong / missing key            → 401 with OpenAI-shaped error
 *   - the /v1/messages (Anthropic) surface keeps accepting both
 *
 * Built as a minimal Hono app in-process so no server needs to start.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { apiKeyAuth, openaiBearerAuth } from '../../src/api/api-key-auth'

const TEST_KEY = 'test-api-key-12345'
const prevKey = process.env.APIKEY

beforeEach(() => {
  process.env.APIKEY = TEST_KEY
})
afterEach(() => {
  if (prevKey === undefined) delete process.env.APIKEY
  else process.env.APIKEY = prevKey
})

function buildApp(): Hono {
  const app = new Hono()
  // Mirror src/index.ts ordering: the more-specific Bearer-only guards
  // are registered before the /v1/* catch-all so they win on their
  // paths and the catch-all still covers /v1/messages.
  app.use('/v1/chat/completions', openaiBearerAuth)
  app.use('/v1/responses', openaiBearerAuth)
  app.use('/v1/models', openaiBearerAuth)
  app.use('/v1/*', apiKeyAuth)
  const ok = (c: { text: (s: string) => Response }): Response => c.text('ok')
  app.get('/v1/models', ok)
  app.post('/v1/chat/completions', ok)
  app.post('/v1/responses', ok)
  app.post('/v1/messages', ok)
  return app
}

describe('openaiBearerAuth (/v1/chat/completions and siblings)', () => {
  test('accepts Authorization: Bearer <APIKEY>', async () => {
    const app = buildApp()
    const res = await app.fetch(
      new Request('http://local/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_KEY}` }
      })
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  test('rejects x-api-key even when the value matches APIKEY', async () => {
    const app = buildApp()
    const res = await app.fetch(
      new Request('http://local/v1/chat/completions', {
        method: 'POST',
        headers: { 'x-api-key': TEST_KEY }
      })
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: { type?: string; code?: string } }
    // OpenAI-shaped error envelope: {error: {message, type, code}}.
    expect(body.error?.type).toBe('invalid_request_error')
    expect(body.error?.code).toBe('invalid_api_key')
  })

  test('rejects a bogus Bearer key', async () => {
    const app = buildApp()
    const res = await app.fetch(
      new Request('http://local/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer nope' }
      })
    )
    expect(res.status).toBe(401)
  })

  test('/v1/responses is guarded the same way', async () => {
    const app = buildApp()
    const rejected = await app.fetch(
      new Request('http://local/v1/responses', {
        method: 'POST',
        headers: { 'x-api-key': TEST_KEY }
      })
    )
    expect(rejected.status).toBe(401)
    const ok = await app.fetch(
      new Request('http://local/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_KEY}` }
      })
    )
    expect(ok.status).toBe(200)
  })

  test('GET /v1/models is guarded the same way', async () => {
    const app = buildApp()
    const rejected = await app.fetch(
      new Request('http://local/v1/models', { headers: { 'x-api-key': TEST_KEY } })
    )
    expect(rejected.status).toBe(401)
    const ok = await app.fetch(
      new Request('http://local/v1/models', { headers: { authorization: `Bearer ${TEST_KEY}` } })
    )
    expect(ok.status).toBe(200)
  })
})

describe('apiKeyAuth (/v1/messages) — legacy dual-mode', () => {
  test('accepts x-api-key (the Anthropic convention Claude Code sends)', async () => {
    const app = buildApp()
    const res = await app.fetch(
      new Request('http://local/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': TEST_KEY }
      })
    )
    expect(res.status).toBe(200)
  })

  test('also accepts Authorization: Bearer for callers that prefer it', async () => {
    const app = buildApp()
    const res = await app.fetch(
      new Request('http://local/v1/messages', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_KEY}` }
      })
    )
    expect(res.status).toBe(200)
  })

  test('401 envelope stays Anthropic-shaped on /v1/messages', async () => {
    const app = buildApp()
    const res = await app.fetch(new Request('http://local/v1/messages', { method: 'POST' }))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { type?: string; error?: { type?: string } }
    expect(body.type).toBe('error')
    expect(body.error?.type).toBe('authentication_error')
  })
})
