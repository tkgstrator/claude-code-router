import { z } from '@hono/zod-openapi'

export const RefreshOutcomeSchema = z
  .object({
    provider: z.string().nonempty(),
    added: z.array(z.string().nonempty()),
    error: z.string().optional()
  })
  .openapi('RefreshOutcome')

export const RefreshModelsResponseSchema = z
  .object({
    outcomes: z.array(RefreshOutcomeSchema)
  })
  .openapi('RefreshModelsResponse')

export const ModelTestRequestSchema = z
  .object({
    provider: z.string().nonempty(),
    model: z.string().nonempty()
  })
  .openapi('ModelTestRequest')

export const ModelTestResultSchema = z
  .object({
    provider: z.string().nonempty(),
    model: z.string().nonempty(),
    status: z.enum(['ok', 'fail']),
    error: z.string().optional(),
    latencyMs: z.number().int().nonnegative()
  })
  .openapi('ModelTestResult')

export const ModelTestAllRequestSchema = z
  .object({
    scope: z.enum(['all', 'failing'])
  })
  .openapi('ModelTestAllRequest')

export const ModelTestAllResponseSchema = z
  .object({
    total: z.number().int().nonnegative(),
    ok: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    results: z.array(ModelTestResultSchema)
  })
  .openapi('ModelTestAllResponse')

// PATCH /api/providers/:name/models/:model. Every field is optional
// so the caller can send just the slice it wants to change. `enabled`
// stays required-shaped for back-compat; the route handler treats
// missing fields as "no change".
export const UpdateModelBodySchema = z.object({
  enabled: z.boolean().optional(),
  // Manual tier override consumed by the quota-aware selector. Send
  // one of the four canonical tiers to set, or null to clear the
  // override (fall back to name inference). Omit the field entirely
  // to leave the current value untouched.
  manualTier: z.enum(['fable', 'opus', 'sonnet', 'haiku']).nullable().optional(),
  // Manual reasoning-effort override for OpenAI / OpenAI-Responses /
  // Codex models. null clears the override (vendor default); omit to
  // leave the current value untouched. `minimal` is gpt-5 family only.
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).nullable().optional()
})

export const ReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high']).openapi('ReasoningEffort')
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>

export const UpdateModelSuccessResponseSchema = z
  .object({ success: z.literal(true) })
  .openapi('UpdateModelSuccessResponse')

export const UpdateModelErrorResponseSchema = z
  .object({ success: z.literal(false), error: z.string().nonempty() })
  .openapi('UpdateModelErrorResponse')

// Vendor /v1/models response shapes. OpenAI-compatible returns
// `{ data: [{ id }] }`; Google Gemini returns `{ models: [{ name }] }`.
// We accept either and pluck only the identifier — anything else
// (description, capabilities, …) is ignored.
export const VendorModelsResponseSchema = z
  .object({
    data: z.array(z.object({ id: z.string().nonempty().optional() })).optional(),
    models: z.array(z.object({ name: z.string().nonempty().optional() })).optional()
  })
  .loose()
