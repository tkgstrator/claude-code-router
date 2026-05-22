/**
 * Zod schemas for the unified LLM chat domain.
 *
 * These describe the inbound canonical shape every transformer produces
 * (after `transformRequestOut`) and consumes (in `transformRequestIn`).
 * Defining them in Zod lets the pipeline `safeParse` an inbound body
 * once and pass the typed result through the rest of the chain.
 *
 * Ported from src/llms/types.ts during the Zod migration.
 */

import { z } from '@hono/zod-openapi'

// ─── Annotations / citations ───────────────────────────────────────────

export const UrlCitationSchema = z.object({
  url: z.string().nonempty(),
  title: z.string().nonempty(),
  content: z.string().nonempty(),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().nonnegative()
})
export type UrlCitation = z.infer<typeof UrlCitationSchema>

export const AnnotationSchema = z.object({
  type: z.literal('url_citation'),
  url_citation: UrlCitationSchema.optional()
})
export type Annotation = z.infer<typeof AnnotationSchema>

// ─── Message content blocks ────────────────────────────────────────────

export const TextContentSchema = z.object({
  type: z.literal('text'),
  text: z.string().nonempty(),
  cache_control: z.object({ type: z.string().nonempty().optional() }).optional()
})
export type TextContent = z.infer<typeof TextContentSchema>

export const ImageContentSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({ url: z.string().nonempty() }),
  media_type: z.string().nonempty()
})
export type ImageContent = z.infer<typeof ImageContentSchema>

export const MessageContentSchema = z.discriminatedUnion('type', [TextContentSchema, ImageContentSchema])
export type MessageContent = z.infer<typeof MessageContentSchema>

// ─── Tool calls ────────────────────────────────────────────────────────

export const UnifiedToolCallSchema = z.object({
  id: z.string().nonempty(),
  type: z.literal('function'),
  function: z.object({
    name: z.string().nonempty(),
    arguments: z.string().nonempty()
  })
})
export type UnifiedToolCall = z.infer<typeof UnifiedToolCallSchema>

// ─── Messages ──────────────────────────────────────────────────────────

export const UnifiedMessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool'])
export type UnifiedMessageRole = z.infer<typeof UnifiedMessageRoleSchema>

export const UnifiedMessageSchema = z.object({
  role: UnifiedMessageRoleSchema,
  content: z.union([z.string().nonempty(), z.null(), z.array(MessageContentSchema)]),
  tool_calls: z.array(UnifiedToolCallSchema).default([]),
  tool_call_id: z.string().nonempty().optional(),
  cache_control: z.object({ type: z.string().nonempty().optional() }).optional(),
  thinking: z
    .object({
      content: z.string().nonempty(),
      signature: z.string().nonempty().optional()
    })
    .optional()
})
// Use the INPUT side so producers (transformers building messages) can
// omit fields that the schema fills in via `.default(…)` on parse.
export type UnifiedMessage = z.input<typeof UnifiedMessageSchema>

// ─── Tool definitions ──────────────────────────────────────────────────

export const UnifiedToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().nonempty(),
    description: z.string().nonempty(),
    parameters: z.object({
      type: z.literal('object'),
      properties: z.record(z.string().nonempty(), z.unknown()),
      required: z.array(z.string().nonempty()).default([]),
      additionalProperties: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
      $schema: z.string().nonempty().optional()
    })
  }),
  cache_control: z.object({ type: z.string().nonempty() }).optional()
})
export type UnifiedTool = z.input<typeof UnifiedToolSchema>

// ─── Reasoning effort ──────────────────────────────────────────────────

export const ThinkLevelSchema = z.enum(['none', 'low', 'medium', 'high'])
export type ThinkLevel = z.infer<typeof ThinkLevelSchema>

// ─── Unified chat request / response ───────────────────────────────────

export const UnifiedChatRequestSchema = z.object({
  messages: z.array(UnifiedMessageSchema),
  model: z.string().nonempty(),
  max_tokens: z.number().optional(),
  temperature: z.number().optional(),
  stream: z.boolean().default(false),
  tools: z.array(UnifiedToolSchema).default([]),
  tool_choice: z
    .union([
      z.enum(['auto', 'none', 'required']),
      z.string().nonempty(),
      z.object({
        type: z.literal('function'),
        function: z.object({ name: z.string().nonempty() })
      })
    ])
    .optional(),
  reasoning: z
    .object({
      effort: ThinkLevelSchema.optional(),
      max_tokens: z.number().optional(),
      enabled: z.boolean().default(false)
    })
    .optional()
})
export type UnifiedChatRequest = z.input<typeof UnifiedChatRequestSchema>

export const UnifiedChatResponseSchema = z.object({
  id: z.string().nonempty(),
  model: z.string().nonempty(),
  content: z.union([z.string().nonempty(), z.null()]),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative()
    })
    .optional(),
  tool_calls: z.array(UnifiedToolCallSchema).default([]),
  annotations: z.array(AnnotationSchema).default([])
})
export type UnifiedChatResponse = z.input<typeof UnifiedChatResponseSchema>

// ─── Anthropic incoming request shapes ─────────────────────────────────
// Schemas for the inbound `/v1/messages` payload. The Anthropic
// transformer parses requests through these schemas so the conversion
// to the unified shape can rely on narrowed, optional-aware types
// instead of `as`-cast structural types.

export const AnthropicCacheControlSchema = z.object({
  // When a cache_control block is present, Anthropic mandates the
  // discriminator (currently always "ephemeral"). Optional removed.
  type: z.string().nonempty()
})
export type AnthropicCacheControl = z.input<typeof AnthropicCacheControlSchema>

export const AnthropicSystemBlockSchema = z.object({
  // A system block is always `{ type: "text", text: "..." }` on the
  // wire — both fields are required when the block is present.
  type: z.string().nonempty(),
  text: z.string().nonempty(),
  cache_control: AnthropicCacheControlSchema.optional()
})
export type AnthropicSystemBlock = z.input<typeof AnthropicSystemBlockSchema>

// Anthropic image blocks come in two shapes — base64 (data + media_type)
// or url (url + media_type). Discriminated by `type` so consumers narrow
// without re-checking each subfield.
export const AnthropicBase64ImageSourceSchema = z.object({
  type: z.literal('base64'),
  media_type: z.string().nonempty(),
  data: z.string().nonempty()
})
export const AnthropicUrlImageSourceSchema = z.object({
  type: z.literal('url'),
  media_type: z.string().nonempty(),
  url: z.string().nonempty()
})
export const AnthropicImageSourceSchema = z.discriminatedUnion('type', [
  AnthropicBase64ImageSourceSchema,
  AnthropicUrlImageSourceSchema
])
export type AnthropicImageSource = z.input<typeof AnthropicImageSourceSchema>

export const AnthropicContentBlockSchema = z.object({
  type: z.string().nonempty(),
  text: z.string().nonempty().optional(),
  id: z.string().nonempty().optional(),
  name: z.string().nonempty().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().nonempty().optional(),
  content: z.unknown().optional(),
  cache_control: AnthropicCacheControlSchema.optional(),
  source: AnthropicImageSourceSchema.optional(),
  thinking: z.string().min(0).optional(),
  signature: z.string().nonempty().optional()
})
export type AnthropicContentBlock = z.input<typeof AnthropicContentBlockSchema>

export const AnthropicIncomingMessageSchema = z.object({
  role: z.string().nonempty(),
  content: z.union([z.string().nonempty(), z.array(AnthropicContentBlockSchema)])
})
export type AnthropicIncomingMessage = z.input<typeof AnthropicIncomingMessageSchema>

export const AnthropicToolDefSchema = z.object({
  name: z.string().nonempty(),
  // Anthropic API requires `description` on every tool definition —
  // the docs treat it as load-bearing for model tool selection.
  description: z.string().nonempty(),
  input_schema: UnifiedToolSchema.shape.function.shape.parameters,
  cache_control: AnthropicCacheControlSchema.optional()
})
export type AnthropicToolDef = z.input<typeof AnthropicToolDefSchema>

// Anthropic tool_choice is one of: `auto` / `any` / `none` (no extra
// fields) or `tool` (which mandates the target `name`). Modelling as a
// discriminated union pulls the `name === undefined` defensive guard
// in the consumer up to schema-time.
export const AnthropicAutoToolChoiceSchema = z.object({ type: z.literal('auto') })
export const AnthropicAnyToolChoiceSchema = z.object({ type: z.literal('any') })
export const AnthropicNoneToolChoiceSchema = z.object({ type: z.literal('none') })
export const AnthropicSpecificToolChoiceSchema = z.object({
  type: z.literal('tool'),
  name: z.string().nonempty()
})
export const AnthropicToolChoiceSchema = z.discriminatedUnion('type', [
  AnthropicAutoToolChoiceSchema,
  AnthropicAnyToolChoiceSchema,
  AnthropicNoneToolChoiceSchema,
  AnthropicSpecificToolChoiceSchema
])
export type AnthropicToolChoice = z.input<typeof AnthropicToolChoiceSchema>

export const AnthropicIncomingRequestSchema = z.object({
  model: z.string().nonempty(),
  // max_tokens is required by the Anthropic Messages API spec.
  max_tokens: z.number().int().positive(),
  temperature: z.number().optional(),
  stream: z.boolean().default(false),
  system: z.union([z.string().nonempty(), z.array(AnthropicSystemBlockSchema)]).optional(),
  messages: z.array(AnthropicIncomingMessageSchema).default([]),
  tools: z.array(AnthropicToolDefSchema).default([]),
  tool_choice: AnthropicToolChoiceSchema.optional(),
  thinking: z
    .object({
      // When thinking is enabled, Anthropic mandates both fields —
      // type is the discriminator and budget_tokens is the ceiling.
      type: z.string().nonempty(),
      budget_tokens: z.number().int().nonnegative().optional()
    })
    .optional(),
  // Claude Code extension fields observed in captured traffic.
  // Typed loosely — internal shapes may evolve without notice.
  metadata: z.record(z.string(), z.unknown()).optional(),
  context_management: z.record(z.string(), z.unknown()).optional(),
  output_config: z.record(z.string(), z.unknown()).optional(),
  diagnostics: z.record(z.string(), z.unknown()).optional()
})
export type AnthropicIncomingRequest = z.input<typeof AnthropicIncomingRequestSchema>

// ─── Anthropic incoming request headers ────────────────────────────────
// Headers that Claude Code (or any compliant client) must send to CCR's
// /v1/messages endpoint. Validated against the captured fixture corpus in
// fixture-schemas.test.ts so a breaking change to the expected header set
// surfaces as a test failure rather than a runtime surprise.

export const AnthropicIncomingRequestHeadersSchema = z
  .object({
    // Required by the Anthropic Messages API spec.
    'anthropic-version': z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'anthropic-version must be YYYY-MM-DD'),
    // Exactly one of these auth headers must be present.
    'x-api-key': z.string().min(1).optional(),
    authorization: z.string().min(1).optional(),
    // Standard MIME type — optional but always sent by Claude Code.
    'content-type': z.string().optional(),
    // Comma-separated beta feature flags e.g. "interleaved-thinking-2025-05-14".
    'anthropic-beta': z.string().optional()
  })
  .passthrough()
  .refine((h) => h['x-api-key'] !== undefined || h['authorization'] !== undefined, {
    message: 'Request must carry either x-api-key or authorization header'
  })

export type AnthropicIncomingRequestHeaders = z.input<typeof AnthropicIncomingRequestHeadersSchema>
