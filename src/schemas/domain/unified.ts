/**
 * Zod schemas for the unified LLM chat domain.
 *
 * These describe the inbound canonical shape every transformer produces
 * (after `transformRequestOut`) and consumes (in `transformRequestIn`).
 * Defining them in Zod lets the pipeline `safeParse` an inbound body
 * once and pass the typed result through the rest of the chain.
 *
 * This is the domain layer, not wire/: the shape is ours. Every inbound
 * surface converts into it and every outbound transformer converts out
 * of it, which is precisely what makes adding a surface cheap — a new
 * wire format only has to reach this shape, never the other formats.
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

/** Tool-choice narrowing helper shape — UnifiedChatRequest's tool_choice
 *  union allows arbitrary strings plus a structured object; this is the
 *  structured object variant. */
export const ToolChoiceFunctionObjectSchema = z.object({
  type: z.literal('function').optional(),
  function: z.object({ name: z.string().nonempty() })
})
export type ToolChoiceFunctionObject = z.input<typeof ToolChoiceFunctionObjectSchema>
