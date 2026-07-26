/**
 * react-hook-form schemas for the UI. Kept here (rather than inline in
 * each component) so all Zod schemas in the repo live under
 * `src/schemas/*.dto.ts`.
 *
 * Uses plain `zod` (not `@hono/zod-openapi`) because these schemas are
 * never registered with the OpenAPI document — they're internal to the
 * React UI's form validation.
 */

import { z } from 'zod'

// Transformer edit dialog form. `path` is the module path; `options`
// is a list of arbitrary key/value pairs supplied to the transformer.
export const TransformerFormSchema = z.object({
  path: z.string().min(1),
  options: z.array(z.object({ key: z.string().nonempty(), value: z.string().nonempty() }))
})
export type TransformerFormValues = z.infer<typeof TransformerFormSchema>

// Settings page form. Envelope scalars with UI-friendly defaults so
// blank fields don't fail validation.
export const SettingsFormSchema = z.object({
  LOG: z.boolean(),
  LOG_LEVEL: z.string().nonempty(),
  CLAUDE_PATH: z.string().default(''),
  HOST: z.string().default(''),
  PORT: z.number().int().positive(),
  API_TIMEOUT_MS: z.number().int().nonnegative(),
  PROXY_URL: z.string().default(''),
  APIKEY: z.string().default(''),
  CUSTOM_ROUTER_PATH: z.string().default('')
})
export type SettingsFormInput = z.input<typeof SettingsFormSchema>
export type SettingsFormOutput = z.output<typeof SettingsFormSchema>
