/**
 * Typed Hono context variables.
 *
 * The auth middleware resolves who is calling and the routes downstream
 * need that answer. Declaring the shape here means `c.get('accessToken')`
 * is typed at every read instead of each handler asserting it back into
 * existence.
 */

import type { ResolvedToken } from '../services/access-token-service'

/**
 * How an /api request got past the gate.
 *
 * Three distinct answers, and the screen that reports them was
 * conflating two: `local` means no credential was presented or needed,
 * which is not the same as one having been checked.
 */
export type AuthVia = 'local' | 'cloudflare_access' | 'token'

declare module 'hono' {
  interface ContextVariableMap {
    /** Which path admitted this request. */
    authVia: AuthVia
    /** Email from a verified Access assertion. Absent on the other paths. */
    accessEmail: string | null
    /** The issued token that authenticated a /v1 call, when one did. */
    accessToken: ResolvedToken
  }
}
