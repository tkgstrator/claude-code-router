/**
 * GET /api/identity — who the edge says is calling.
 *
 * DISPLAY ONLY. This endpoint reports an identity for the sidebar; it is
 * not an authentication decision and nothing may gate on its output. The
 * `Cf-Access-*` headers it reads are trivially forgeable by anything that
 * can reach the origin directly, which is exactly why the real gate is
 * (a) Cloudflare Access at the edge and (b) the API-key middleware that
 * already guards every /api route including this one.
 *
 * Verifying the Access JWT against the team JWKS — and thereby making this
 * a trustworthy claim — is Phase 3.5 of the Rialto plan.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

const ResponseSchema = z
  .object({
    mode: z.enum(['cloudflare_access', 'token']),
    email: z.string().nonempty().nullable()
  })
  .openapi('IdentityResponse')

export const identityRoute = new OpenAPIHono()

identityRoute.openapi(
  createRoute({
    method: 'get',
    path: '/api/identity',
    responses: {
      200: {
        description: 'Display-only identity for the shell footer',
        content: { 'application/json': { schema: ResponseSchema } }
      }
    }
  }),
  (c) => {
    const email = c.req.header('cf-access-authenticated-user-email')
    const assertion = c.req.header('cf-access-jwt-assertion')
    const viaAccess = typeof assertion === 'string' && assertion.length > 0
    return c.json(
      {
        mode: viaAccess ? ('cloudflare_access' as const) : ('token' as const),
        email: typeof email === 'string' && email.length > 0 ? email : null
      },
      200
    )
  }
)
