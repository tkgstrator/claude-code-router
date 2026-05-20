/**
 * Gemini request shaping helpers.
 *
 * `buildRequestBody` converts a unified chat request into the Gemini
 * `generateContent` wire shape; `transformRequestOut` performs the
 * reverse for inbound Gemini-shaped requests (used when the Gemini
 * transformer is acting as the endpoint).
 */

import { HTTPException } from 'hono/http-exception'
import {
  type GeminiContent,
  type GeminiFunctionCallPart,
  type GeminiFunctionResponsePart,
  type GeminiGenerationConfig,
  type GeminiInboundContent,
  GeminiInboundRequestSchema,
  type GeminiInboundTool,
  type GeminiPart,
  type GeminiTextPart,
  type GeminiThinkingConfig,
  type GeminiToolConfig,
  type MessageContent,
  type ThinkLevel,
  type ToolChoiceFunctionObject,
  type UnifiedChatRequest,
  type UnifiedMessage,
  type UnifiedTool
} from '@/schemas'
import { type GeminiFunctionDeclaration, type GeminiTool, tTool } from './gemini-schema'

// ─── Gemini wire shapes ─────────────────────────────────────────────────
// All schemas live in `@/schemas/llm-gemini.dto`; this file imports the
// inferred types and emits values that match them.

/** Gemini `generateContent` request body (what we POST upstream). */
export type GeminiRequestBody = {
  contents: GeminiContent[]
  tools?: GeminiTool[]
  generationConfig: GeminiGenerationConfig
  toolConfig?: GeminiToolConfig
}

const isToolChoiceFunctionObject = (value: unknown): value is ToolChoiceFunctionObject => {
  if (typeof value !== 'object' || value === null || !('function' in value)) {
    return false
  }
  const fn = value.function
  return typeof fn === 'object' && fn !== null && 'name' in fn && typeof fn.name === 'string'
}

/**
 * Narrow an inbound (Zod-parsed) `tool_choice` value into the shape the
 * unified chat request accepts: one of the literal strings, the
 * structured function-object, or `undefined` if absent / unrecognised.
 */
function normalizeToolChoice(value: unknown): UnifiedChatRequest['tool_choice'] {
  if (value === undefined) {
    return undefined
  }
  if (value === 'auto' || value === 'none' || value === 'required') {
    return value
  }
  if (typeof value === 'string') {
    return value
  }
  if (isToolChoiceFunctionObject(value)) {
    return { type: 'function', function: { name: value.function.name } }
  }
  return undefined
}

const genRandomToolId = (): string => `tool_${Math.random().toString(36).substring(2, 15)}`

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Parse a `tool_calls[].function.arguments` JSON string into the
 * arg-record shape Gemini expects. Falls back to an empty record on
 * an empty / missing payload; throws an HTTPException if the JSON
 * parses but isn't object-shaped.
 */
function parseToolArguments(rawArgs: string | undefined): Record<string, unknown> {
  const source = rawArgs && rawArgs.length > 0 ? rawArgs : '{}'
  const parsed: unknown = JSON.parse(source)
  if (!isPlainRecord(parsed)) {
    throw new HTTPException(500, {
      message: `Invalid Gemini tool-call arguments JSON: expected object, got ${typeof parsed}`
    })
  }
  return parsed
}

/**
 * Map the unified message role onto the Gemini role enum.
 * Anything other than `assistant` collapses to `'user'` to mirror the
 * legacy contract.
 */
function geminiRoleOf(message: UnifiedMessage): 'user' | 'model' {
  return message.role === 'assistant' ? 'model' : 'user'
}

/**
 * Build parts[] from a string-valued message body, attaching the
 * thoughtSignature when present.
 */
function buildStringContentParts(content: string, message: UnifiedMessage): GeminiPart[] {
  const part: GeminiTextPart = { text: content }
  if (message?.thinking?.signature) {
    part.thoughtSignature = message.thinking.signature
  }
  return [part]
}

/** Build parts[] from a structured array message body. */
function buildArrayContentParts(content: MessageContent[]): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ text: block.text })
      continue
    }
    if (block.type === 'image_url') {
      parts.push(buildImagePart(block.image_url.url, block.media_type))
    }
  }
  return parts
}

/**
 * Defensive fallback branch for object-shaped message content. The
 * unified type does not allow it, but the vendor implementation
 * accepted `{ text: "..." }` objects so we keep the behaviour and
 * stringify anything else.
 */
function buildObjectContentParts(content: object): GeminiPart[] {
  const obj: Record<string, unknown> = { ...content }
  if (typeof obj.text === 'string') {
    return [{ text: obj.text }]
  }
  return [{ text: JSON.stringify(content) }]
}

/**
 * Build the `parts[]` for a single non-tool message. Splits the parts
 * dispatch (string vs. array vs. defensive object) so the caller stays
 * readable.
 */
function buildMessageParts(message: UnifiedMessage): GeminiPart[] {
  if (typeof message.content === 'string') {
    return buildStringContentParts(message.content, message)
  }
  if (Array.isArray(message.content)) {
    return buildArrayContentParts(message.content)
  }
  if (message.content && typeof message.content === 'object') {
    return buildObjectContentParts(message.content)
  }
  return []
}

/**
 * Build an image part — either remote `file_data` for HTTP URLs or
 * inline base64 `inlineData` for data URLs.
 */
function buildImagePart(url: string, mediaType: string): GeminiPart {
  if (url.startsWith('http')) {
    return { file_data: { mime_type: mediaType, file_uri: url } }
  }
  // data: URIs come through as `data:<mime>;base64,<payload>` — take the
  // payload after the comma. Fall back to the original URL string when
  // there is no comma, mirroring the legacy behaviour.
  const commaIndex = url.indexOf(',')
  const data = commaIndex >= 0 ? url.slice(commaIndex + 1) : url
  return { inlineData: { mime_type: mediaType, data } }
}

/**
 * Append `functionCall` parts derived from the assistant message's
 * `tool_calls` (if any). The first call carries the thoughtSignature
 * so Gemini can reconstruct the reasoning chain.
 */
function appendToolCallParts(parts: GeminiPart[], message: UnifiedMessage): void {
  if (!Array.isArray(message.tool_calls)) {
    return
  }
  message.tool_calls.forEach((toolCall, index) => {
    const part: GeminiFunctionCallPart = {
      functionCall: {
        id: toolCall.id || genRandomToolId(),
        name: toolCall.function.name,
        args: parseToolArguments(toolCall.function.arguments)
      }
    }
    if (index === 0 && message.thinking?.signature) {
      part.thoughtSignature = message.thinking.signature
    }
    parts.push(part)
  })
}

/**
 * Build the `parts[]` slice that carries tool *responses* to be sent
 * after an assistant tool-call turn.
 */
function buildToolResponseParts(
  message: UnifiedMessage,
  toolResponses: UnifiedMessage[]
): GeminiFunctionResponsePart[] | null {
  if (!message.tool_calls) {
    return null
  }
  return message.tool_calls.map((tool) => {
    const response = toolResponses.find((item) => item.tool_call_id === tool.id)
    return {
      functionResponse: {
        name: tool?.function?.name,
        response: { result: response?.content }
      }
    }
  })
}

/** Pick the thinking budget bracket appropriate for the requested model. */
function thinkingBudgetBracketFor(model: string): readonly [number, number] {
  return model.includes('pro') ? [128, 32768] : [0, 24576]
}

/** Clamp a requested thinking budget into the model's bracket. */
function clampThinkingBudget(max_tokens: number, bracket: readonly [number, number]): number {
  if (max_tokens < bracket[0]) {
    return bracket[0]
  }
  if (max_tokens > bracket[1]) {
    return bracket[1]
  }
  return max_tokens
}

/** Build the `generationConfig` block from the request's reasoning hints. */
function buildGenerationConfig(request: UnifiedChatRequest): GeminiGenerationConfig {
  const generationConfig: GeminiGenerationConfig = {}
  if (!request.reasoning?.effort || request.reasoning.effort === 'none') {
    return generationConfig
  }
  const thinkingConfig: GeminiThinkingConfig = { includeThoughts: true }
  if (request.model.includes('gemini-3')) {
    thinkingConfig.thinkingLevel = request.reasoning.effort
  } else {
    const bracket = thinkingBudgetBracketFor(request.model)
    const max_tokens = request.reasoning.max_tokens
    if (typeof max_tokens !== 'undefined') {
      thinkingConfig.thinkingBudget = clampThinkingBudget(max_tokens, bracket)
    }
  }
  generationConfig.thinkingConfig = thinkingConfig
  return generationConfig
}

/** Build the `toolConfig` block from the request's `tool_choice`. */
function buildToolConfig(toolChoice: UnifiedChatRequest['tool_choice']): GeminiToolConfig | undefined {
  if (!toolChoice) {
    return undefined
  }
  const toolConfig: GeminiToolConfig = { functionCallingConfig: {} }
  if (toolChoice === 'auto') {
    toolConfig.functionCallingConfig.mode = 'auto'
  } else if (toolChoice === 'none') {
    toolConfig.functionCallingConfig.mode = 'none'
  } else if (toolChoice === 'required') {
    toolConfig.functionCallingConfig.mode = 'any'
  } else if (isToolChoiceFunctionObject(toolChoice)) {
    toolConfig.functionCallingConfig.mode = 'any'
    toolConfig.functionCallingConfig.allowedFunctionNames = [toolChoice.function.name]
  }
  return toolConfig
}

/** Build the `tools[]` slice (function declarations + optional googleSearch). */
function buildTools(requestTools: UnifiedChatRequest['tools']): GeminiTool[] {
  const tools: GeminiTool[] = []
  const functionDeclarations: GeminiFunctionDeclaration[] | undefined = requestTools
    ?.filter((tool) => tool.function.name !== 'web_search')
    ?.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parametersJsonSchema: tool.function.parameters
    }))
  if (functionDeclarations?.length) {
    tools.push(tTool({ functionDeclarations }))
  }
  if (requestTools?.some((tool) => tool.function.name === 'web_search')) {
    tools.push({ googleSearch: {} })
  }
  return tools
}

/**
 * Build the `contents[]` slice. Skips tool-role messages (their
 * payloads are paired against the preceding assistant tool call) and
 * appends a synthetic `user` turn carrying tool responses after each
 * assistant tool-call turn.
 */
function buildContents(messages: UnifiedMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = []
  const toolResponses = messages.filter((item) => item.role === 'tool')
  for (const message of messages) {
    if (message.role === 'tool') {
      continue
    }
    const role = geminiRoleOf(message)
    const parts: GeminiPart[] = buildMessageParts(message)
    appendToolCallParts(parts, message)
    if (parts.length === 0) {
      parts.push({ text: '' })
    }
    contents.push({ role, parts })

    if (role === 'model') {
      const responseParts = buildToolResponseParts(message, toolResponses)
      if (responseParts) {
        contents.push({ role: 'user', parts: responseParts })
      }
    }
  }
  return contents
}

/**
 * Convert a unified chat request into the Gemini `generateContent`
 * request body shape.
 */
export function buildRequestBody(request: UnifiedChatRequest): GeminiRequestBody {
  const tools = buildTools(request.tools)
  const contents = buildContents(request.messages)
  const generationConfig = buildGenerationConfig(request)

  const body: GeminiRequestBody = {
    contents,
    tools: tools.length ? tools : undefined,
    generationConfig
  }

  const toolConfig = buildToolConfig(request.tool_choice)
  if (toolConfig) {
    body.toolConfig = toolConfig
  }
  return body
}

// ─── Inbound (Gemini-shaped → unified) ─────────────────────────────────

/**
 * Convert one inbound Gemini `contents[]` entry into a unified message,
 * or return `null` if the entry shape is unsupported.
 */
function inboundContentToMessage(content: GeminiInboundContent): UnifiedMessage | null {
  if (typeof content === 'string') {
    return { role: 'user', content }
  }
  if (typeof content.text === 'string') {
    return { role: 'user', content: content.text.length > 0 ? content.text : null }
  }
  if (content.role === 'user') {
    return {
      role: 'user',
      content: content.parts.map((part) => ({ type: 'text', text: part.text }))
    }
  }
  if (content.role === 'model') {
    return {
      role: 'assistant',
      content: content.parts.map((part) => ({ type: 'text', text: part.text }))
    }
  }
  return null
}

/** Default JSON Schema body for a Gemini tool whose parameters are omitted. */
const EMPTY_PARAMETERS: UnifiedTool['function']['parameters'] = {
  type: 'object',
  properties: {}
}

/**
 * Loose type guard for the JSON-Schema-shaped `parameters` block on a
 * Gemini function declaration. We only check the `type === 'object'`
 * top-level marker — deeper validation is the schema's job.
 */
function isUnifiedToolParameters(value: unknown): value is UnifiedTool['function']['parameters'] {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return 'type' in value && value.type === 'object'
}

/**
 * Convert an inbound Gemini `tools[]` entry into the unified tool
 * representation. The Gemini wire schema is JSON-Schema-shaped so we
 * pass `parameters` through unchanged (with an empty-object fallback).
 */
function inboundToolToUnifiedTools(tool: GeminiInboundTool): UnifiedTool[] {
  const declarations = tool.functionDeclarations
  if (!Array.isArray(declarations)) {
    return []
  }
  return declarations.map((decl): UnifiedTool => {
    const parameters = isUnifiedToolParameters(decl.parameters) ? decl.parameters : EMPTY_PARAMETERS
    return {
      type: 'function',
      function: {
        name: decl.name,
        description: decl.description,
        parameters
      }
    }
  })
}

/**
 * Inverse of `buildRequestBody`: parse an inbound Gemini-shaped request
 * back into the unified `UnifiedChatRequest` representation. Used when
 * the Gemini transformer is the endpoint transformer for an upstream
 * Gemini-compatible client.
 */
export function transformRequestOut(request: Record<string, unknown>): UnifiedChatRequest {
  const parsed = GeminiInboundRequestSchema.safeParse(request)
  if (!parsed.success) {
    throw new HTTPException(500, {
      message: `Invalid inbound Gemini request: ${parsed.error.message}`
    })
  }
  const { contents, tools, model, max_tokens, temperature, stream, tool_choice } = parsed.data

  const unifiedChatRequest: UnifiedChatRequest = {
    messages: [],
    model,
    max_tokens,
    temperature,
    stream,
    tool_choice: normalizeToolChoice(tool_choice)
  }

  if (Array.isArray(contents)) {
    for (const content of contents) {
      const message = inboundContentToMessage(content)
      if (message) {
        unifiedChatRequest.messages.push(message)
      }
    }
  }

  if (Array.isArray(tools)) {
    const unifiedTools: UnifiedTool[] = []
    for (const tool of tools) {
      unifiedTools.push(...inboundToolToUnifiedTools(tool))
    }
    unifiedChatRequest.tools = unifiedTools
  }

  return unifiedChatRequest
}
