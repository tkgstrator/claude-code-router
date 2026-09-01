/**
 * Is this request coming from the machine Rialto runs on?
 *
 * Local operation should not require typing a token into your own
 * laptop. But "local" has to be judged carefully here, because the
 * obvious test is wrong in exactly this project's deployment:
 * cloudflared runs on the same host and proxies to 127.0.0.1, so with a
 * tunnel in front EVERY request from the public internet arrives from
 * loopback. Trusting the peer address alone would publish the admin API
 * to the world at the moment the operator set up their tunnel.
 *
 * Two signals, both required:
 *
 *   1. The `Host` the client asked for is a loopback name. A browser on
 *      the machine sends `localhost:16175`; a tunnelled request carries
 *      the public hostname, because cloudflared preserves it.
 *
 *   2. No forwarding headers. Anything relayed through Cloudflare, a
 *      reverse proxy or a load balancer says so — `cf-connecting-ip`,
 *      `cf-ray`, `x-forwarded-*`, `x-real-ip`. Their presence means the
 *      request did not originate on this machine, whatever Host claims.
 *
 * What this deliberately does not defend against: something that can
 * already open a TCP connection to the port and set arbitrary headers.
 * On loopback that is a process on the machine, which can read the
 * config file and take the token anyway. Off the machine it means the
 * origin is directly reachable — the thing the deployment guide says
 * not to allow, and which no header check can repair.
 *
 * Set RIALTO_TRUST_LOCAL=false to require a credential even locally.
 */

import type { Context } from 'hono'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

// Any of these means the request was relayed rather than made here.
const FORWARDING_HEADERS = [
  'cf-connecting-ip',
  'cf-ray',
  'cf-access-jwt-assertion',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded'
]

export function isLocalRequest(c: Context): boolean {
  if (process.env.RIALTO_TRUST_LOCAL === 'false') return false

  for (const header of FORWARDING_HEADERS) {
    const value = c.req.header(header)
    if (typeof value === 'string' && value.length > 0) return false
  }

  const host = c.req.header('host')
  if (typeof host !== 'string' || host.length === 0) return false
  // Strip the port. IPv6 literals keep their brackets, which is why
  // both bracketed and bare forms are in the set above.
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}
