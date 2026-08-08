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

// PATCH /api/providers/:name/models/:model
// Both fields optional so the endpoint can be used for either the
// enable/disable toggle or a contextWindow edit (or both in one call).
// A refine keeps at least one field required, so an empty {} is rejected
// instead of being a silent no-op — the client asked for a mutation.
// contextWindow accepts null to clear a previously-set value.
export const UpdateModelBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    contextWindow: z.number().int().positive().nullable().optional()
  })
  .refine((v) => v.enabled !== undefined || v.contextWindow !== undefined, {
    message: 'at least one of enabled or contextWindow must be present'
  })

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
