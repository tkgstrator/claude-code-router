/**
 * Shared response helper for routes that hand-roll body validation with
 * `Schema.safeParse(...)`. Returns a 400 with the typed `issues` array
 * so a UI can render per-field errors without re-parsing strings.
 *
 * The point of this layer (vs. throwing ZodError and catching in
 * app.onError) is that safeParse keeps the request path
 * exception-free — control flow stays linear, no try/catch anywhere
 * in the route, no global handler indirection.
 */

import type { Context } from 'hono'
import type { ZodError } from 'zod'

export const badRequestForZod = (c: Context, error: ZodError) =>
  c.json(
    {
      success: false as const,
      error: {
        type: 'validation_error' as const,
        issues: error.issues
      }
    },
    400
  )
