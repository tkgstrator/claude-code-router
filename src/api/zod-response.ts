/**
 * Shared response helper for routes that hand-roll body validation with
 * `Schema.safeParse(...)`. Returns a 400 with the typed `issues` array
 * so a UI can render per-field errors without re-parsing strings.
 *
 * The point of this layer (vs. throwing ZodError and catching in
 * app.onError) is that safeParse keeps the request path
 * exception-free — control flow stays linear, no try/catch anywhere
 * in the route, no global handler indirection.
 *
 * `validationErrorHook` wires the same shape into createRoute-based
 * sub-apps: pass it as `defaultHook` on `new OpenAPIHono({...})` so
 * request validation failures from the @hono/zod-openapi middleware
 * surface in the same envelope as the hand-rolled paths.
 *
 * `ValidationErrorResponseSchema` is the wire shape both paths emit —
 * exported so createRoute responses can declare it as the 400 shape
 * (keeps OpenAPI docs in sync with the actual response).
 */

import { z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { ZodError } from 'zod'

export const ValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.object({
      type: z.literal('validation_error'),
      // `issues` is the zod issue array; the inner shape varies per
      // issue kind, so we keep it as `unknown[]` here rather than
      // enumerating every zod issue variant.
      issues: z.array(z.unknown())
    })
  })
  .openapi('ValidationErrorResponse')

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

type HookResult = { success: true } | { success: false; error: ZodError }

export const validationErrorHook = (result: HookResult, c: Context) => {
  if (!result.success) return badRequestForZod(c, result.error)
}
