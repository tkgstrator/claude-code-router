/**
 * What /api/transformers returns: the registry listing, which is a
 * different shape from the on-disk entry in domain/transformer.ts —
 * it names endpoints instead of module paths and carries no options.
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
