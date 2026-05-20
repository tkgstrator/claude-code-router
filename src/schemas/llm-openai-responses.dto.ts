/**
 * Zod schemas for the OpenAI Responses API (`/v1/responses`).
 *
 * These describe the wire-level shapes the OpenAIResponsesTransformer
 * parses out of upstream replies (both the non-streaming JSON envelope
 * and the streaming SSE events). Field types are intentionally loose —
 * upstream omits or renames keys across model families, so we keep
 * everything optional and `safeParse` defensively at the boundary.
 *
 * For fields where the original transformer used `?? '<empty>'`
 * fallbacks, the schema uses `.default(...)` so consumers can read
 * fields directly without a fallback expression at the call site.
 */

import { z } from '@hono/zod-openapi'
import { UnifiedChatRequestSchema } from './llm-chat.dto'

// ─── Annotation block on output_text content ───────────────────────────

// Upstream omits these inconsistently per model family. Defaults keep
// downstream consumers fallback-free.
export const ResponsesAnnotationSchema = z.object({
  url: z.string().default(''),
  title: z.string().default(''),
  start_index: z.number().default(0),
  end_index: z.number().default(0)
})
export type ResponsesAnnotation = z.infer<typeof ResponsesAnnotationSchema>

// ─── Output content blocks (JSON payload) ──────────────────────────────

export const ResponsesAPIOutputContentSchema = z.object({
  type: z.string().nonempty(),
  text: z.string().nonempty().optional(),
  image_url: z.string().nonempty().optional(),
  mime_type: z.string().nonempty().optional(),
  image_base64: z.string().nonempty().optional(),
  annotations: z.array(ResponsesAnnotationSchema).default([])
})
export type ResponsesAPIOutputContent = z.infer<typeof ResponsesAPIOutputContentSchema>

// ─── Output items (message / function_call) ────────────────────────────

export const ResponsesAPIOutputItemSchema = z.object({
  type: z.string().nonempty(),
  id: z.string().nonempty().optional(),
  call_id: z.string().nonempty().optional(),
  name: z.string().nonempty().optional(),
  arguments: z.string().nonempty().optional(),
  content: z.array(ResponsesAPIOutputContentSchema).default([]),
  reasoning: z.string().nonempty().optional()
})
export type ResponsesAPIOutputItem = z.infer<typeof ResponsesAPIOutputItemSchema>

// ─── Non-streaming JSON response envelope ──────────────────────────────

export const ResponsesAPIPayloadSchema = z.object({
  id: z.string().nonempty().optional(),
  object: z.string().nonempty().optional(),
  model: z.string().nonempty().optional(),
  created_at: z.number().optional(),
  output: z.array(ResponsesAPIOutputItemSchema).default([]),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      total_tokens: z.number()
    })
    .optional()
})
export type ResponsesAPIPayload = z.infer<typeof ResponsesAPIPayloadSchema>

// ─── Streaming output_item.added inner item ────────────────────────────

export const ResponsesStreamItemContentSchema = z.object({
  type: z.string().nonempty(),
  text: z.string().nonempty().optional(),
  image_url: z.string().nonempty().optional(),
  mime_type: z.string().nonempty().optional()
})
export type ResponsesStreamItemContent = z.infer<typeof ResponsesStreamItemContentSchema>

export const ResponsesStreamItemSchema = z.object({
  id: z.string().nonempty().optional(),
  type: z.string().nonempty().optional(),
  call_id: z.string().nonempty().optional(),
  name: z.string().nonempty().optional(),
  content: z.array(ResponsesStreamItemContentSchema).default([]),
  reasoning: z.string().nonempty().optional()
})
export type ResponsesStreamItem = z.infer<typeof ResponsesStreamItemSchema>

// ─── Streaming SSE event envelope ──────────────────────────────────────

// `delta` is sometimes a string (text deltas) and sometimes an object
// (image base64 deltas). Modelled as a union.
export const ResponsesStreamDeltaSchema = z.union([
  z.string().nonempty(),
  z.object({
    url: z.string().nonempty().optional(),
    b64_json: z.string().nonempty().optional(),
    mime_type: z.string().nonempty().optional()
  })
])
export type ResponsesStreamDelta = z.infer<typeof ResponsesStreamDeltaSchema>

export const ResponsesStreamEventSchema = z.object({
  type: z.string().nonempty(),
  item_id: z.string().nonempty().optional(),
  output_index: z.number().optional(),
  delta: ResponsesStreamDeltaSchema.optional(),
  item: ResponsesStreamItemSchema.optional(),
  response: z
    .object({
      id: z.string().nonempty().optional(),
      model: z.string().nonempty().optional(),
      output: z.array(z.object({ type: z.string().nonempty() })).default([])
    })
    .optional(),
  annotation: ResponsesAnnotationSchema.optional(),
  part: z.unknown().optional(),
  reasoning_summary: z.string().nonempty().optional()
})
export type ResponsesStreamEvent = z.infer<typeof ResponsesStreamEventSchema>

// ─── Codex (ChatGPT subscription) request shape ────────────────────────
//
// The Codex backend (chatgpt.com/backend-api/codex) requires several
// Responses-API fields that the unified chat request schema doesn't
// model. codex-oauth populates them just-in-time before sending.

export const CodexRequestShapeSchema = UnifiedChatRequestSchema.extend({
  store: z.boolean().default(false),
  instructions: z.string().min(0).optional(),
  prompt_cache_key: z.string().nonempty().optional(),
  input: z.unknown().optional()
})
export type CodexRequestShape = z.input<typeof CodexRequestShapeSchema>

// ─── Responses-API request shape ───────────────────────────────────────
//
// `openai-responses` transforms a UnifiedChatRequest into this shape
// (which adds `instructions` / `input` / `parallel_tool_calls`) before
// the body hits the upstream endpoint.

export const ResponsesUnifiedChatRequestSchema = UnifiedChatRequestSchema.extend({
  instructions: z.string().min(0).optional(),
  input: z.array(z.unknown()).default([]),
  parallel_tool_calls: z.boolean().default(false)
})
export type ResponsesUnifiedChatRequest = z.input<typeof ResponsesUnifiedChatRequestSchema>
