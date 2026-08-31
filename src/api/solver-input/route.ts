/**
 * Solver input inspection endpoint (offline IP-solver Phase A).
 *
 * `GET /api/solver-input?windowHours=<n>` returns the pure
 * `SolverInput` object a later phase will feed to the LP/IP solver.
 * Phase A is data pipeline only — nothing here computes a plan, the
 * route exists so operators can inspect what the solver will see.
 *
 * Auth: mounted BELOW the shared `adminAuth` middleware in
 * `src/index.ts`, same as `/api/router-utilization` and the rest of
 * the /api/* surface.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { SolverInputSchema } from '../../schemas'
import { collectSolverInput } from '../../services/solver/collect-input'

export const solverInputRoute = new OpenAPIHono()

const route = createRoute({
  method: 'get',
  path: '/api/solver-input',
  request: {
    query: z.object({
      windowHours: z.coerce.number().int().positive().max(168).default(4)
    })
  },
  responses: {
    200: {
      description: 'Pure solver input snapshot over the requested window',
      content: { 'application/json': { schema: SolverInputSchema } }
    }
  }
})

solverInputRoute.openapi(route, async (c) => {
  const { windowHours } = c.req.valid('query')
  const out = await collectSolverInput(windowHours)
  return c.json(out, 200)
})
