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
 * thing an operator wants to see before exposing the tunnel:
 * `cloudflare_access` is a verified human, `token` is the bootstrap
 * credential, and `local` is a browser on this machine, which presents
 * nothing at all.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import '../context'
import { readAccessConfig } from '../../services/cloudflare-access'

const ResponseSchema = z
  .object({
    // How THIS request got in. `local` means no credential was presented
    // or needed — reporting that as `token` claimed a credential had been
    // checked when none had.
    mode: z.enum(['local', 'cloudflare_access', 'token']),
    email: z.string().nonempty().nullable(),
    // Whether ACCESS_TEAM_DOMAIN + ACCESS_AUD are both set. False means a
    // remote /api/* request is gated by the bootstrap token alone, which
    // is worth saying plainly on a deployment about to be public.
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
    // adminAuth stamps the path it took. Absent only if this handler is
    // reached without it, which no mounted route does.
    const via = c.get('authVia')
    return c.json(
      {
        mode: via === undefined ? 'token' : via,
        email: typeof email === 'string' && email.length > 0 ? email : null,
        accessConfigured: readAccessConfig() !== null
      },
      200
    )
  }
)
