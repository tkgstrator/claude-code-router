import { z } from '@hono/zod-openapi'

export const SessionSummarySchema = z.object({
  sessionId: z.string().nonempty(),
  requestCount: z.number(),
  providers: z.array(z.string().nonempty()),
  models: z.array(z.string().nonempty()),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalCacheReadTokens: z.number(),
  totalCacheWriteTokens: z.number(),
  avgCacheHitPct: z.number(),
  totalDurationMs: z.number(),
  totalCostUsd: z.number().nullable(),
  firstAt: z.string().nonempty(),
  lastAt: z.string().nonempty()
})

export const RequestLogItemSchema = z.object({
  id: z.string().nonempty(),
  sessionId: z.string().nonempty(),
  provider: z.string().nonempty(),
  model: z.string().nonempty(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalInputTokens: z.number(),
  cacheHitPct: z.number(),
  durationMs: z.number(),
  status: z.number(),
  createdAt: z.string().nonempty(),
  inputCostUsd: z.number().nullable(),
  outputCostUsd: z.number().nullable(),
  cacheReadCostUsd: z.number().nullable(),
  totalCostUsd: z.number().nullable()
})

// Paginated list/sessions query params: ?limit&offset.
export const RequestLogsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0)
})

export const RequestLogsSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0)
})

export const SessionIdParamSchema = z.object({ sessionId: z.string().nonempty() })
export const RequestLogIdParamSchema = z.object({ id: z.string().nonempty() })

export const SessionsResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema),
  total: z.number()
})

export const SessionLogsResponseSchema = z.object({
  items: z.array(RequestLogItemSchema)
})

export const RequestLogsListResponseSchema = z.object({
  items: z.array(RequestLogItemSchema),
  total: z.number()
})

export const RequestLogsDeleteAllResponseSchema = z.object({ deleted: z.number() })

export const RequestLogsDeleteOneResponseSchema = z.object({ id: z.string().nonempty() })
