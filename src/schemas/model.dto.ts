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
    latencyMs: z.number()
  })
  .openapi('ModelTestResult')

export const ModelTestAllRequestSchema = z
  .object({
    scope: z.enum(['all', 'failing'])
  })
  .openapi('ModelTestAllRequest')

export const ModelTestAllResponseSchema = z
  .object({
    total: z.number(),
    ok: z.number(),
    fail: z.number(),
    results: z.array(ModelTestResultSchema)
  })
  .openapi('ModelTestAllResponse')

// PATCH /api/providers/:name/models/:model
export const UpdateModelBodySchema = z.object({
  enabled: z.boolean()
})
