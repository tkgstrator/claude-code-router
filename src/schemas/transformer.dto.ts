import { z } from '@hono/zod-openapi'

// On-disk transformer config entry (envelope.transformers[]).
export const TransformerSchema = z.object({
  name: z.string().nonempty().optional(),
  path: z.string().nonempty(),
  options: z.record(z.string().nonempty(), z.any()).optional()
})
export type Transformer = z.infer<typeof TransformerSchema>

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
