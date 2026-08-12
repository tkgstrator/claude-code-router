/**
 * GET /health — public monitoring endpoint.
 *
 * Deliberately outside the APIKEY gate so uptime probes and k8s
 * liveness/readiness checks don't need to carry a secret. Runs one
 * cheap DB reachability check per call; skips it (with `db: 'skip'`)
 * when DATABASE_URL isn't wired (test / bootstrap environments) so
 * the endpoint stays green during first-run seed.
 *
 * Response shape:
 *   {
 *     status: 'ok' | 'degraded',
 *     version: '<APP_VERSION>',
 *     uptime_seconds: <int>,
 *     checks: { db: 'ok' | 'fail' | 'skip' }
 *   }
 *
 * Status code: 200 when nothing failed, 503 when any check fails.
 */

import { Hono } from 'hono'
import { getPrismaClient } from '../../db/client'
import { APP_VERSION } from '../../version'

const bootedAt = Math.floor(Date.now() / 1000)

export const healthRoute = new Hono()

healthRoute.get('/health', async (c) => {
  const checks: Record<string, 'ok' | 'fail' | 'skip'> = {}

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0) {
    try {
      // biome-ignore plugin: the Prisma raw tag needs a bound `this`, which the tagged-template call provides directly. Wrapped in try/catch so a downed DB flips the check to 'fail' rather than throwing to the caller.
      await getPrismaClient().$queryRaw`SELECT 1`
      checks.db = 'ok'
    } catch {
      checks.db = 'fail'
    }
  } else {
    checks.db = 'skip'
  }

  const allOk = Object.values(checks).every((v) => v !== 'fail')
  return c.json(
    {
      status: allOk ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptime_seconds: Math.floor(Date.now() / 1000) - bootedAt,
      checks
    },
    allOk ? 200 : 503
  )
})
