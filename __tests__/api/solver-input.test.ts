import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { solverInputRoute } from '../../src/api/solver-input/route'
import { SolverInputSchema } from '../../src/schemas'
import { HAS_DB, resetDbTables, teardownPrisma } from '../db/helpers'

const describeOrSkip = HAS_DB ? describe : describe.skip

// Cold-boot (empty DB) end-to-end: the route mounts under the shared
// apiKeyAuth middleware in src/index.ts, so calling the sub-app
// directly here bypasses auth (mirrors the pattern used by
// routing-scheduler-state.test.ts).
describeOrSkip('GET /api/solver-input (DB)', () => {
  beforeEach(async () => {
    await resetDbTables()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('returns 200 with a schema-valid empty snapshot on a fresh DB', async () => {
    const res = await solverInputRoute.fetch(new Request('http://local/api/solver-input?windowHours=6'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const parsed = SolverInputSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('unreachable')
    expect(parsed.data.windowHours).toBe(6)
    expect(parsed.data.scenarios).toEqual([])
    expect(parsed.data.targets).toEqual([])
    expect(parsed.data.accounts).toEqual([])
  })

  test('defaults windowHours to 4 when omitted', async () => {
    const res = await solverInputRoute.fetch(new Request('http://local/api/solver-input'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { windowHours: number }
    expect(body.windowHours).toBe(4)
  })

  test('rejects windowHours > 168 (7-day cap)', async () => {
    const res = await solverInputRoute.fetch(new Request('http://local/api/solver-input?windowHours=200'))
    expect(res.status).toBe(400)
  })
})
