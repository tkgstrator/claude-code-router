/**
 * Cloudflare Access JWT verification for /api/*.
 *
 * Access authenticates the operator at the edge and forwards the result
 * as a signed assertion in `Cf-Access-Jwt-Assertion`. Verifying that
 * signature is what makes the header trustworthy: the header alone is
 * forgeable by anything that can reach the origin directly, which is
 * precisely the case a tunnel does not rule out.
 *
 * Three checks, all required:
 *   - signature against the team's published JWKS
 *   - `iss` equals the team domain, so another team's token is not
 *     accepted
 *   - `aud` contains this application's AUD tag, so a token minted for
 *     a different app on the same team is not accepted either
 *
 * The last one is the easy one to skip and the one that matters most:
 * without it, anyone your team lets into any Access application can
 * reach this one.
 *
 * RS256 is verified through node:crypto, which imports a JWK directly —
 * no JWT dependency, and nothing to keep patched.
 */

import { createPublicKey, createVerify } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'

const JWKS_TTL_MS = 60 * 60 * 1000

const JwkSchema = z.object({
  kid: z.string().nonempty(),
  kty: z.literal('RSA'),
  n: z.string().nonempty(),
  e: z.string().nonempty(),
  alg: z.string().nonempty().optional()
})

const JwksSchema = z.object({ keys: z.array(JwkSchema) })

const ClaimsSchema = z.object({
  iss: z.string().nonempty(),
  // Cloudflare sends `aud` as an array of AUD tags.
  aud: z.union([z.string().nonempty(), z.array(z.string().nonempty())]),
  exp: z.number(),
  email: z.string().nonempty().optional(),
  sub: z.string().nonempty().optional()
})

export interface AccessIdentity {
  email: string | null
  subject: string | null
}

export interface AccessConfig {
  teamDomain: string
  aud: string
}

/**
 * Reduce a team domain to the bare host this module builds URLs from.
 *
 * Pasting the domain with its scheme is the most likely way to type
 * this field, and the consequences used to be invisible until it was
 * too late: `https://https://team…/cdn-cgi/access/certs` fetches
 * nothing, and the `iss` comparison below never matches, so every admin
 * request is rejected with no way back through the browser.
 *
 * Exported so the pre-save check normalises identically. Two
 * normalisers is how a configuration passes validation and then fails
 * at runtime.
 */
export function normalizeTeamDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

/**
 * Access is configured only when BOTH values are present. A half
 * configuration must not authenticate anything — verifying a signature
 * without checking the audience would accept every app on the team.
 */
export function readAccessConfig(): AccessConfig | null {
  const teamDomain = process.env.ACCESS_TEAM_DOMAIN
  const aud = process.env.ACCESS_AUD
  if (typeof teamDomain !== 'string' || teamDomain.trim().length === 0) return null
  if (typeof aud !== 'string' || aud.trim().length === 0) return null
  const host = normalizeTeamDomain(teamDomain)
  return host.length === 0 ? null : { teamDomain: host, aud: aud.trim() }
}

const jwksCache = new LRUCache<string, Map<string, string>>({ max: 4, ttl: JWKS_TTL_MS })

// kid -> PEM. Cached for an hour: Cloudflare rotates signing keys, and
// re-fetching per request would put an outbound call in front of every
// admin API call.
async function loadKeys(teamDomain: string): Promise<Map<string, string>> {
  const cached = jwksCache.get(teamDomain)
  if (cached !== undefined) return cached

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
  const parsed = JwksSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('JWKS response did not match the expected shape')

  const keys = new Map<string, string>()
  for (const jwk of parsed.data.keys) {
    // `format: 'pem'` always yields a string; the overload is shared with
    // the DER form, which is why the return type is widened.
    const pem = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' }).export({
      type: 'spki',
      format: 'pem'
    })
    if (typeof pem === 'string') keys.set(jwk.kid, pem)
  }
  jwksCache.set(teamDomain, keys)
  return keys
}

const b64urlToBuffer = (value: string): Buffer => Buffer.from(value, 'base64url')

// Decode a base64url JSON segment. Attacker-controlled input, so a
// segment that is not base64, not UTF-8, or not JSON has to come back as
// "no claims" — throwing here would turn a malformed assertion into a
// 500 instead of the 401 it is.
const decodeSegment = (segment: string): unknown => {
  try {
    return JSON.parse(b64urlToBuffer(segment).toString('utf8'))
  } catch {
    return null
  }
}

const HeaderSchema = z.object({ alg: z.literal('RS256'), kid: z.string().nonempty() })

/**
 * Verify an assertion and return who it says is calling.
 *
 * Returns null on every failure — malformed, wrong issuer, wrong
 * audience, expired, unknown key, unreachable JWKS. The caller turns
 * that into a 401; there is deliberately no way to distinguish the
 * reasons from outside, and no path that returns an identity without a
 * verified signature.
 */
export async function verifyAccessJwt(assertion: string, config: AccessConfig): Promise<AccessIdentity | null> {
  const parts = assertion.split('.')
  if (parts.length !== 3) return null
  const [encodedHeader, encodedPayload, encodedSignature] = parts

  const header = HeaderSchema.safeParse(decodeSegment(encodedHeader))
  if (!header.success) return null

  const keys = await loadKeys(config.teamDomain).catch(() => null)
  if (keys === null) return null
  const pem = keys.get(header.data.kid)
  if (pem === undefined) return null

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${encodedHeader}.${encodedPayload}`)
  verifier.end()
  if (!verifier.verify(pem, b64urlToBuffer(encodedSignature))) return null

  const claims = ClaimsSchema.safeParse(decodeSegment(encodedPayload))
  if (!claims.success) return null

  if (claims.data.exp * 1000 <= Date.now()) return null
  if (claims.data.iss !== `https://${config.teamDomain}`) return null

  const audiences = Array.isArray(claims.data.aud) ? claims.data.aud : [claims.data.aud]
  if (!audiences.includes(config.aud)) return null

  return {
    email: claims.data.email === undefined ? null : claims.data.email,
    subject: claims.data.sub === undefined ? null : claims.data.sub
  }
}

/** Drops cached signing keys. Used by tests. */
export function resetAccessKeyCache(): void {
  jwksCache.clear()
}
