/**
 * The transformer entry as it is stored on disk (envelope.transformers[]).
 * Domain, not api: it is read at boot from the config file, and only
 * incidentally echoed back by /api/transformers.
 */

import { z } from '@hono/zod-openapi'

// On-disk transformer config entry (envelope.transformers[]).
export const TransformerSchema = z.object({
  name: z.string().nonempty().optional(),
  path: z.string().nonempty(),
  options: z.record(z.string().nonempty(), z.any()).optional()
})
export type Transformer = z.infer<typeof TransformerSchema>
