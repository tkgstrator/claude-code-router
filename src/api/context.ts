/**
 * Typed Hono context variables.
 *
 * The auth middleware resolves who is calling and the routes downstream
 * need that answer. Declaring the shape here means `c.get('accessToken')`
 * is typed at every read instead of each handler asserting it back into
 * existence.
 */

import type { ResolvedToken } from '../services/access-token-service'

declare module 'hono' {
  interface ContextVariableMap {
    /** Email from a verified Access assertion. Absent on the token path. */
    accessEmail: string | null
    /** The issued token that authenticated a /v1 call, when one did. */
    accessToken: ResolvedToken
  }
}
