/**
 * GET /api/identity — who the edge verified is calling.
 *
 * Unlike the first cut of this endpoint, the answer is now verified
 * rather than reported: `adminAuth` has already checked the Access
 * assertion's signature, issuer and audience before this handler runs,
 * and stashed the email it carried. A forged `Cf-Access-*` header does
 * not reach here — the request is rejected upstream.
 *
 * `mode` says which door the caller actually came through, which is the
 * thing an operator wants to see before exposing the tunnel: `token`
 * means Access is not in front (or was bypassed via the bootstrap
 * token), `cloudflare_access` means a verified human.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import '../context'
import { readAccessConfig } from '../../services/cloudflare-access'

const ResponseSchema = z
  .object({
    mode: z.enum(['cloudflare_access', 'token']),
    email: z.string().nonempty().nullable(),
    // Whether ACCESS_TEAM_DOMAIN + ACCESS_AUD are both set. False means
    // every /api/* request is gated by the single bootstrap token, which
    // is worth saying plainly on a deployment that is about to be public.
    accessConfigured: z.boolean()
  })
  .openapi('IdentityResponse')

export const identityRoute = new OpenAPIHono()

identityRoute.openapi(
  createRoute({
    method: 'get',
    path: '/api/identity',
    responses: {
      200: {
        description: 'The verified caller identity for this request',
        content: { 'application/json': { schema: ResponseSchema } }
      }
    }
  }),
  (c) => {
    const email = c.get('accessEmail')
    return c.json(
      {
        mode: typeof email === 'string' ? ('cloudflare_access' as const) : ('token' as const),
        email: typeof email === 'string' && email.length > 0 ? email : null,
        accessConfigured: readAccessConfig() !== null
      },
      200
    )
  }
)
