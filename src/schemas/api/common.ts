/**
 * Response envelopes shared by more than one /api/* route. They sit in
 * the api layer rather than primitives because they are registered with
 * the OpenAPI document and only ever appear on the management API.
 */

import { z } from '@hono/zod-openapi'

export const ValidationErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.string().nonempty()
  })
  .openapi('ValidationError')
