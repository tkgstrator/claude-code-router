/**
 * GET /health — public monitoring surface.
 *
 * Verifies the endpoint responds without an APIKEY (uptime probes
 * don't carry one) and returns a machine-readable JSON envelope
 * rather than the SPA HTML that used to catch this path.
 */

import { describe, expect, test } from 'bun:test'
import { healthRoute } from '../../src/api/health/route'

describe('GET /health', () => {
  test('returns 200 with a machine-readable envelope, no auth required', async () => {
    const res = await healthRoute.fetch(new Request('http://local/health'))
    // Bun test env has DATABASE_URL dropped in __tests__/setup.ts when
    // no TEST_DATABASE_URL is set, so the db check is either 'skip' or
    // 'ok'. Neither should make the endpoint 503.
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: 'ok' | 'degraded'
      version: string
      uptime_seconds: number
      checks: Record<string, 'ok' | 'fail' | 'skip'>
    }
    expect(body.status).toBe('ok')
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
    expect(typeof body.uptime_seconds).toBe('number')
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0)
    expect(body.checks.db).toMatch(/^(ok|skip|fail)$/)
  })

  test('response Content-Type is JSON (not HTML — the SPA fallback used to eat this path)', async () => {
    const res = await healthRoute.fetch(new Request('http://local/health'))
    expect(res.headers.get('content-type')?.startsWith('application/json')).toBe(true)
  })
})
