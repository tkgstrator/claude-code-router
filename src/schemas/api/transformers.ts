/**
 * What /api/transformers returns: the live registry listing built in
 * `src/llms/context.ts` — the transformers that are actually loaded,
 * named alongside the endpoint each one posts to. Read-only; there is
 * no on-disk transformer config to reconcile it against.
 */

import { z } from '@hono/zod-openapi'

// Registry list returned by /api/transformers (name + endpoint, not config).
export const TransformerEntrySchema = z
  .object({
    name: z.string().nonempty(),
    endpoint: z.string().nullable()
  })
  .openapi('TransformerEntry')

export const TransformersResponseSchema = z
  .object({
    transformers: z.array(TransformerEntrySchema)
  })
  .openapi('TransformersResponse')
