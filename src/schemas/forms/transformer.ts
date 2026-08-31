/**
 * The transformer edit dialog form.
 *
 * Plain `zod` for the same reason as the settings form: form shapes are
 * never registered with the OpenAPI document.
 *
 * `options` is a key/value *list* rather than the record that
 * domain/transformer.ts stores, because a record cannot express a row
 * being edited toward a key that does not exist yet.
 */

import { z } from 'zod'

export const TransformerFormSchema = z.object({
  path: z.string().min(1),
  options: z.array(z.object({ key: z.string().nonempty(), value: z.string().nonempty() }))
})
export type TransformerFormValues = z.infer<typeof TransformerFormSchema>
