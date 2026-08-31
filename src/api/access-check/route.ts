/**
 * POST /api/access-check — dry-run a Cloudflare Access configuration.
 *
 * Exists because the settings that enable Access are the settings that
 * can lock you out of the screen you set them on. `adminAuth`
 * deliberately does not fall back to the bootstrap token when an
 * assertion is present but fails to verify — falling back there would
 * let anyone holding that token bypass Access while appearing verified.
 * The cost of that correctness is that a mistyped team domain or AUD,
 * once saved, rejects every browser request forever, and the only way
 * back is editing the config file by hand.
 *
 * So: check first, save second. Nothing here is persisted.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { resetAccessKeyCache, verifyAccessJwt } from '../../services/cloudflare-access'
import '../context'

const BodySchema = z
  .object({
    teamDomain: z.string().nonempty(),
    aud: z.string().nonempty()
  })
  .openapi('AccessCheckRequest')

const ResponseSchema = z
  .object({
    // Does the team domain publish a JWKS? Catches a mistyped domain,
    // which is the failure that cannot be recovered from the browser.
    jwksReachable: z.boolean(),
    keyCount: z.number().int().nonnegative(),
    // Whether THIS request carried an Access assertion. False when the
    // operator is still reaching the origin directly, in which case the
    // audience cannot be checked yet and saving is a leap of faith.
    assertionPresent: z.boolean(),
    // Whether that assertion verifies against the proposed settings.
    // Null when there was no assertion to check.
    assertionValid: z.boolean().nullable(),
    email: z.string().nonempty().nullable(),
    // Plain-language verdict for the UI to show verbatim.
    detail: z.string().nonempty()
  })
  .openapi('AccessCheckResponse')

export const accessCheckRoute = new OpenAPIHono()

accessCheckRoute.openapi(
  createRoute({
    method: 'post',
    path: '/api/access-check',
    request: { body: { content: { 'application/json': { schema: BodySchema } } } },
    responses: {
      200: {
        description: 'Whether these settings would work. Nothing is saved.',
        content: { 'application/json': { schema: ResponseSchema } }
      }
    }
  }),
  async (c) => {
    const { teamDomain, aud } = c.req.valid('json')
    const domain = teamDomain.replace(/^https:\/\//, '').replace(/\/+$/, '')

    const certs = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(5000)
    }).catch(() => null)

    const keys =
      certs !== null && certs.ok
        ? await certs
            .json()
            .then((body: unknown) =>
              body !== null && typeof body === 'object' && Array.isArray(Reflect.get(body, 'keys'))
                ? Reflect.get(body, 'keys').length
                : 0
            )
            .catch(() => 0)
        : 0

    if (certs === null || !certs.ok || keys === 0) {
      return c.json(
        {
          jwksReachable: false,
          keyCount: 0,
          assertionPresent: false,
          assertionValid: null,
          detail: `No signing keys published at ${domain}. Check the team domain — it looks like <team>.cloudflareaccess.com. Saving this would reject every browser request.`,
          email: null
        },
        200
      )
    }

    const assertion = c.req.header('cf-access-jwt-assertion')
    if (typeof assertion !== 'string' || assertion.length === 0) {
      return c.json(
        {
          jwksReachable: true,
          keyCount: keys,
          assertionPresent: false,
          assertionValid: null,
          detail: `The team domain is valid and publishes ${keys} signing keys, but this request did not arrive through Access, so the AUD tag could not be checked. Reach this page through the Access-protected hostname to verify it before relying on it.`,
          email: null
        },
        200
      )
    }

    // Verify the caller's own assertion against the proposed settings.
    // Cached keys are dropped first so a domain typed a moment ago is
    // fetched rather than answered from a previous attempt.
    resetAccessKeyCache()
    const identity = await verifyAccessJwt(assertion, { teamDomain: domain, aud })
    resetAccessKeyCache()

    return c.json(
      {
        jwksReachable: true,
        keyCount: keys,
        assertionPresent: true,
        assertionValid: identity !== null,
        email: identity?.email === undefined ? null : identity.email,
        detail:
          identity === null
            ? 'Your own Access assertion does NOT verify against these settings — most likely the AUD tag belongs to a different application. Saving this would lock you out of this screen.'
            : `Verified. Your assertion checks out against these settings${identity.email === null ? '' : ` as ${identity.email}`}, so saving them is safe.`
      },
      200
    )
  }
)
