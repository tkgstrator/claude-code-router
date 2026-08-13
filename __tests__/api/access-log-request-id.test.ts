/**
 * The accessLog middleware now reflects the request id back as
 * `x-request-id` on the outgoing response so a caller who sees an
 * error can quote the id and let an operator grep it out of pino
 * logs. Verifies:
 *   - a fresh uuid gets minted when the caller doesn't send one
 *   - a caller-supplied `x-request-id` is honoured verbatim
 */

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { accessLog } from '../../src/api/access-log'

function buildApp(): Hono {
  const app = new Hono()
  app.use('/api/*', accessLog)
  app.get('/api/whatever', (c) => c.text('ok'))
  return app
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('accessLog — x-request-id', () => {
  test('mints a uuid when the caller did not supply one', async () => {
    const res = await buildApp().fetch(new Request('http://local/api/whatever'))
    const id = res.headers.get('x-request-id')
    expect(id).not.toBeNull()
    expect(id).toMatch(UUID_LIKE)
  })

  test('honours a caller-supplied x-request-id verbatim', async () => {
    const res = await buildApp().fetch(
      new Request('http://local/api/whatever', { headers: { 'x-request-id': 'trace-abc-123' } })
    )
    expect(res.headers.get('x-request-id')).toBe('trace-abc-123')
  })

  test('empty caller-supplied header falls back to a fresh uuid', async () => {
    const res = await buildApp().fetch(
      new Request('http://local/api/whatever', { headers: { 'x-request-id': '' } })
    )
    const id = res.headers.get('x-request-id')
    expect(id).toMatch(UUID_LIKE)
  })
})
