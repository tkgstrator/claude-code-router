import { z } from '@hono/zod-openapi'

export const SessionSummarySchema = z.object({
  sessionId: z.string().nonempty(),
  requestCount: z.number().int().nonnegative(),
  providers: z.array(z.string().nonempty()),
  models: z.array(z.string().nonempty()),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  totalCacheWriteTokens: z.number().int().nonnegative(),
  // Average across int rows — kept as a plain number to allow fractional values.
  avgCacheHitPct: z.number(),
  totalDurationMs: z.number().int().nonnegative(),
  totalCostUsd: z.number().nullable(),
  firstAt: z.string().nonempty(),
  lastAt: z.string().nonempty()
})

export const RequestLogItemSchema = z.object({
  id: z.string().nonempty(),
  sessionId: z.string().nonempty(),
  provider: z.string().nonempty(),
  model: z.string().nonempty(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  // Prisma column is Int — single-request hit percent is a whole-number percentage.
  cacheHitPct: z.number().int().min(0).max(100),
  durationMs: z.number().int().nonnegative(),
  status: z.number().int(),
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
  offset: z.coerce.number().int().min(0).default(0),
  // Only return sessions active within the last N hours (0 = no time limit).
  // History tends to grow unbounded, so default to a recent window.
  sinceHours: z.coerce.number().int().min(0).max(8760).default(6)
})

export const SessionIdParamSchema = z.object({ sessionId: z.string().nonempty() })
export const RequestLogIdParamSchema = z.object({ id: z.string().nonempty() })

export const SessionsResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema),
  total: z.number().int().nonnegative()
})

export const SessionLogsResponseSchema = z.object({
  items: z.array(RequestLogItemSchema)
})

export const RequestLogsListResponseSchema = z.object({
  items: z.array(RequestLogItemSchema),
  total: z.number().int().nonnegative()
})

export const RequestLogsDeleteAllResponseSchema = z.object({ deleted: z.number().int().nonnegative() })

export const RequestLogsDeleteOneResponseSchema = z.object({ id: z.string().nonempty() })

// One archived chat message. `content` intentionally stays `unknown` — it
// is an Anthropic-shaped block array on assistant rows, and a string or
// block array on user rows (Claude Code's tool_result turns).
export const SessionMessageItemSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.unknown(),
  createdAt: z.string()
})

export const SessionMessagesResponseSchema = z.object({
  items: z.array(SessionMessageItemSchema)
})
