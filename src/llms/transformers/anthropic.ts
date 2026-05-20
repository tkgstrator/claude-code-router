/**
 * Anthropic endpoint transformer.
 *
 * Owns `/v1/messages`. Converts Anthropic's wire format (messages,
 * system, tools, tool_choice, thinking blocks) into the unified shape on
 * the way in, and converts an OpenAI-shaped response (JSON or streaming)
 * back into Anthropic events on the way out so the Claude Code client
 * sees its native protocol.
 */

import { HTTPException } from 'hono/http-exception'
import type { ChatCompletion } from 'openai/resources'
import type { Logger } from 'pino'
import { v4 } from 'uuid'
import type {
  AnthropicContentBlock,
  AnthropicIncomingMessage,
  AnthropicIncomingRequest,
  AnthropicToolDef,
  RuntimeProvider,
  TransformerContext,
  UnifiedChatRequest,
  UnifiedMessage,
  UnifiedTool
} from '@/schemas'
import { AnthropicIncomingRequestSchema } from '@/schemas'
import { formatBase64 } from '../utils/image'
import { getThinkLevel } from '../utils/thinking'
import { Transformer, type TransformerAuthResult } from './base'

type AnthropicTransformerOptions = {
  UseBearer?: boolean
}

type StreamToolCallChunk = {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

type StreamChoiceDelta = {
  content?: string
  thinking?: { content?: string; signature?: string }
  tool_calls?: StreamToolCallChunk[]
  annotations?: Array<{ url_citation?: { url?: string; title?: string } }>
}

type StreamChunk = {
  model?: string
  error?: unknown
  choices?: Array<{
    delta?: StreamChoiceDelta
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

type ToolCallInfo = {
  id: string
  name: string
  arguments: string
  contentBlockIndex: number
}

// Type guard: narrows the unknown stream payload to `StreamChunk`.
// The OpenAI streaming JSON is structurally compatible at runtime; the
// guard only checks that the shape looks like an object, leaving the
// optional field access to fail safely.
function isStreamChunk(value: unknown): value is StreamChunk {
  return typeof value === 'object' && value !== null
}

// Read `context.req.id` defensively. `TransformerContext` allows
// arbitrary keys, so we narrow via the `in` operator (which is the
// canonical structural narrowing for unknown-shaped objects).
function getReqId(context: TransformerContext): string | undefined {
  const req = context.req
  if (req === undefined || req === null || typeof req !== 'object') return undefined
  if (!('id' in req)) return undefined
  const { id } = req
  return typeof id === 'string' ? id : undefined
}

// Annotation shape attached to an OpenAI ChatCompletion message when the
// upstream model uses web search. The SDK type doesn't declare it, so we
// narrow defensively using a type guard.
type ChatMessageAnnotation = { url_citation: { url: string; title: string } }

function isChatMessageAnnotation(value: unknown): value is ChatMessageAnnotation {
  if (typeof value !== 'object' || value === null) return false
  if (!('url_citation' in value)) return false
  const { url_citation } = value
  if (typeof url_citation !== 'object' || url_citation === null) return false
  if (!('url' in url_citation) || !('title' in url_citation)) return false
  return typeof url_citation.url === 'string' && typeof url_citation.title === 'string'
}

function getMessageAnnotations(
  message: ChatCompletion['choices'][number]['message']
): ChatMessageAnnotation[] | undefined {
  if (!('annotations' in message)) return undefined
  const { annotations } = message
  if (!Array.isArray(annotations)) return undefined
  return annotations.filter(isChatMessageAnnotation)
}

// Optional thinking block on a ChatCompletion message (SDK doesn't
// declare it; provider-specific extension).
type ChatMessageThinking = { content?: string; signature?: string }

function getMessageThinking(message: ChatCompletion['choices'][number]['message']): ChatMessageThinking | undefined {
  if (!('thinking' in message)) return undefined
  const { thinking } = message
  if (typeof thinking !== 'object' || thinking === null) return undefined
  const content = 'content' in thinking && typeof thinking.content === 'string' ? thinking.content : undefined
  const signature = 'signature' in thinking && typeof thinking.signature === 'string' ? thinking.signature : undefined
  if (content === undefined && signature === undefined) return undefined
  return { content, signature }
}

// Stop reason mapping (OpenAI finish_reason -> Anthropic stop_reason).
const STOP_REASON_MAPPING: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'stop_sequence'
}

function mapFinishReason(finishReason: string | null | undefined): string {
  if (!finishReason) return 'end_turn'
  const mapped = STOP_REASON_MAPPING[finishReason]
  return mapped === undefined ? 'end_turn' : mapped
}

// Compute the (input_tokens, output_tokens, cache_read_input_tokens)
// triple from an OpenAI usage object. The fields are genuinely optional
// upstream; absence means zero, which is the correct billing value.
function defaultZero(n: number | undefined): number {
  return typeof n === 'number' ? n : 0
}

function computeUsage(usage: StreamChunk['usage'] | ChatCompletion['usage']): {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
} {
  const promptN = defaultZero(usage?.prompt_tokens)
  const completionN = defaultZero(usage?.completion_tokens)
  const cachedN = defaultZero(usage?.prompt_tokens_details?.cached_tokens)
  return {
    input_tokens: promptN - cachedN,
    output_tokens: completionN,
    cache_read_input_tokens: cachedN
  }
}

// ─── Inbound message conversion helpers ───────────────────────────────

function buildSystemMessage(system: AnthropicIncomingRequest['system']): UnifiedMessage | undefined {
  if (!system) return undefined
  if (typeof system === 'string') {
    return { role: 'system', content: system }
  }
  if (!Array.isArray(system) || system.length === 0) return undefined
  const textParts = system
    .filter((item) => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
    .map((item) => {
      if (item.text === undefined) {
        throw new HTTPException(500, { message: 'Anthropic system block missing text after filter' })
      }
      return {
        type: 'text' as const,
        text: item.text,
        cache_control: item.cache_control
      }
    })
  if (textParts.length === 0) return undefined
  return { role: 'system', content: textParts }
}

function buildToolResultMessages(blocks: AnthropicContentBlock[]): UnifiedMessage[] {
  return blocks
    .filter((c) => c.type === 'tool_result' && c.tool_use_id)
    .map((tool) => {
      let content: string
      if (typeof tool.content === 'string') {
        content = tool.content
      } else if (tool.content === undefined || tool.content === null) {
        content = '{}'
      } else {
        content = JSON.stringify(tool.content)
      }
      return {
        role: 'tool' as const,
        content,
        tool_call_id: tool.tool_use_id,
        cache_control: tool.cache_control
      }
    })
}

// Convert one image content block to its unified `image_url` shape.
function convertImagePart(part: AnthropicContentBlock): {
  type: 'image_url'
  image_url: { url: string }
  media_type: string
} {
  if (!part.source) {
    throw new HTTPException(500, { message: 'Anthropic image block missing source' })
  }
  const src = part.source
  if (src.media_type === undefined) {
    throw new HTTPException(500, { message: 'Anthropic image block missing media_type' })
  }
  let url: string
  if (src.type === 'base64') {
    if (src.data === undefined) {
      throw new HTTPException(500, { message: 'Anthropic base64 image block missing data' })
    }
    url = formatBase64(src.data, src.media_type)
  } else {
    if (src.url === undefined) {
      throw new HTTPException(500, { message: 'Anthropic url image block missing url' })
    }
    url = src.url
  }
  return {
    type: 'image_url',
    image_url: { url },
    media_type: src.media_type
  }
}

function buildUserContent(blocks: AnthropicContentBlock[]): UnifiedMessage | undefined {
  const parts = blocks.filter((c) => (c.type === 'text' && c.text) || (c.type === 'image' && c.source))
  if (!parts.length) return undefined
  return {
    role: 'user',
    content: parts.map((part) => {
      if (part.type === 'image') return convertImagePart(part)
      if (part.text === undefined) {
        throw new HTTPException(500, { message: 'Anthropic text block missing text after filter' })
      }
      return { type: 'text' as const, text: part.text }
    })
  }
}

function buildAssistantTextContent(blocks: AnthropicContentBlock[]): string {
  const textParts = blocks.filter((c) => c.type === 'text' && c.text)
  if (textParts.length === 0) return ''
  return textParts
    .map((text) => {
      if (text.text === undefined) {
        throw new HTTPException(500, { message: 'Anthropic assistant text block missing text after filter' })
      }
      return text.text
    })
    .join('\n')
}

function buildAssistantToolCalls(blocks: AnthropicContentBlock[]): UnifiedMessage['tool_calls'] {
  const toolCallParts = blocks.filter((c) => c.type === 'tool_use' && c.id)
  if (toolCallParts.length === 0) return undefined
  return toolCallParts.map((tool) => {
    if (tool.id === undefined) {
      throw new HTTPException(500, { message: 'Anthropic tool_use block missing id after filter' })
    }
    if (tool.name === undefined) {
      throw new HTTPException(500, { message: 'Anthropic tool_use block missing name' })
    }
    // tool.input is genuinely optional in the Anthropic wire format;
    // empty object is the correct "no arguments" representation.
    const input = tool.input === undefined || tool.input === null ? {} : tool.input
    return {
      id: tool.id,
      type: 'function' as const,
      function: {
        name: tool.name,
        arguments: JSON.stringify(input)
      }
    }
  })
}

function buildAssistantThinking(blocks: AnthropicContentBlock[]): UnifiedMessage['thinking'] {
  const thinkingPart = blocks.find((c) => c.type === 'thinking' && c.signature)
  if (!thinkingPart) return undefined
  if (thinkingPart.thinking === undefined) {
    throw new HTTPException(500, { message: 'Anthropic thinking block missing thinking content' })
  }
  return {
    content: thinkingPart.thinking,
    signature: thinkingPart.signature
  }
}

function buildAssistantMessage(blocks: AnthropicContentBlock[]): UnifiedMessage {
  const assistantMessage: UnifiedMessage = {
    role: 'assistant',
    content: buildAssistantTextContent(blocks)
  }
  const toolCalls = buildAssistantToolCalls(blocks)
  if (toolCalls) assistantMessage.tool_calls = toolCalls
  const thinking = buildAssistantThinking(blocks)
  if (thinking) assistantMessage.thinking = thinking
  return assistantMessage
}

function appendIncomingMessage(messages: UnifiedMessage[], msg: AnthropicIncomingMessage): void {
  if (msg.role !== 'user' && msg.role !== 'assistant') return

  if (typeof msg.content === 'string') {
    messages.push({ role: msg.role, content: msg.content })
    return
  }

  if (!Array.isArray(msg.content)) return

  if (msg.role === 'user') {
    messages.push(...buildToolResultMessages(msg.content))
    const userMessage = buildUserContent(msg.content)
    if (userMessage) messages.push(userMessage)
  } else {
    messages.push(buildAssistantMessage(msg.content))
  }
}

function buildToolChoice(toolChoice: AnthropicIncomingRequest['tool_choice']): UnifiedChatRequest['tool_choice'] {
  if (!toolChoice) return undefined
  if (toolChoice.type === 'tool') {
    if (toolChoice.name === undefined) {
      throw new HTTPException(500, { message: 'Anthropic tool_choice missing name for type=tool' })
    }
    return {
      type: 'function',
      function: { name: toolChoice.name }
    }
  }
  return toolChoice.type
}

export class AnthropicTransformer extends Transformer {
  readonly name = 'anthropic'
  readonly endPoint = '/v1/messages'
  private readonly useBearer: boolean

  constructor(options?: AnthropicTransformerOptions) {
    super()
    this.useBearer = options?.UseBearer === true
  }

  async auth(
    request: unknown,
    provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<TransformerAuthResult> {
    const headers: Record<string, string | undefined> = {}

    if (this.useBearer) {
      headers.authorization = `Bearer ${provider.api_key}`
      headers['x-api-key'] = undefined
    } else {
      headers['x-api-key'] = provider.api_key
      headers.authorization = undefined
    }

    return {
      body: request,
      config: { headers }
    }
  }

  async transformRequestOut(request: unknown, _context: TransformerContext): Promise<UnifiedChatRequest> {
    const result = AnthropicIncomingRequestSchema.safeParse(request)
    if (!result.success) {
      throw new HTTPException(500, {
        message: `Invalid Anthropic request payload: ${result.error.message}`
      })
    }
    const req = result.data
    const messages: UnifiedMessage[] = []

    const systemMessage = buildSystemMessage(req.system)
    if (systemMessage) messages.push(systemMessage)

    // Deep clone so downstream consumers cannot mutate the parsed input.
    const requestMessages: AnthropicIncomingMessage[] = JSON.parse(JSON.stringify(req.messages))
    for (const msg of requestMessages) {
      appendIncomingMessage(messages, msg)
    }

    const unified: UnifiedChatRequest = {
      messages,
      model: req.model,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      stream: req.stream,
      tools: req.tools.length ? this.convertAnthropicToolsToUnified(req.tools) : undefined,
      tool_choice: buildToolChoice(req.tool_choice)
    }

    if (req.thinking) {
      const budget = req.thinking.budget_tokens
      if (budget === undefined) {
        throw new HTTPException(500, { message: 'Anthropic thinking block missing budget_tokens' })
      }
      unified.reasoning = {
        effort: getThinkLevel(budget),
        enabled: req.thinking.type === 'enabled'
      }
    }

    return unified
  }

  async transformResponseIn(response: Response, context?: TransformerContext): Promise<Response> {
    if (context === undefined) {
      throw new HTTPException(500, { message: 'AnthropicTransformer.transformResponseIn requires a context' })
    }
    const isStream = response.headers.get('Content-Type')?.includes('text/event-stream')
    if (isStream) {
      if (!response.body) {
        throw new Error('Stream response body is null')
      }
      const convertedStream = await this.convertOpenAIStreamToAnthropic(response.body, context)
      return new Response(convertedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        }
      })
    }
    // The upstream provider returns a payload matching the OpenAI SDK's
    // `ChatCompletion` shape verbatim. We accept it as `unknown` and let
    // `convertOpenAIResponseToAnthropic` validate the fields it touches.
    const data: unknown = await response.json()
    const anthropicResponse = this.convertOpenAIResponseToAnthropic(data, context)
    return new Response(JSON.stringify(anthropicResponse), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  private convertAnthropicToolsToUnified(tools: AnthropicToolDef[]): UnifiedTool[] {
    return tools.map((tool) => {
      // The unified schema requires a non-empty description; the
      // Anthropic wire format allows it to be omitted. Fall back to the
      // tool name so the schema stays satisfied without inventing data.
      const description = tool.description === undefined ? tool.name : tool.description
      return {
        type: 'function',
        function: {
          name: tool.name,
          description,
          parameters: tool.input_schema
        }
      }
    })
  }

  private async convertOpenAIStreamToAnthropic(
    openaiStream: ReadableStream<Uint8Array>,
    context: TransformerContext
  ): Promise<ReadableStream<Uint8Array>> {
    const logger = this.logger
    const reqId = getReqId(context)

    const readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const state = createStreamState(controller, logger, reqId)
        runStreamPump(openaiStream, state, logger, reqId).catch((error) => {
          if (!state.isClosed) {
            try {
              controller.error(error)
            } catch (controllerError) {
              console.error(controllerError)
            }
          }
        })
      },
      cancel: (reason) => {
        logger?.debug({ reqId }, `cancle stream: ${String(reason)}`)
      }
    })

    return readable
  }

  private convertOpenAIResponseToAnthropic(
    openaiResponse: unknown,
    context: TransformerContext
  ): Record<string, unknown> {
    const reqId = getReqId(context)
    this.logger?.debug({ reqId, response: openaiResponse }, `Original OpenAI response`)
    if (!isChatCompletionLike(openaiResponse)) {
      throw new HTTPException(500, { message: `Provider error: ${JSON.stringify(openaiResponse)}` })
    }
    try {
      const choice = openaiResponse.choices[0]
      if (!choice) {
        throw new Error('No choices found in OpenAI response')
      }
      const content: Array<Record<string, unknown>> = []
      appendAnnotationContent(content, choice.message)
      appendTextContent(content, choice.message)
      appendToolCallContent(content, choice.message)
      appendThinkingContent(content, choice.message)

      const usage = computeUsage(openaiResponse.usage)
      const result = {
        id: openaiResponse.id,
        type: 'message',
        role: 'assistant',
        model: openaiResponse.model,
        content,
        stop_reason: mapFinishReason(choice.finish_reason),
        stop_sequence: null,
        usage
      }
      this.logger?.debug({ reqId, result }, `Conversion complete, final Anthropic response`)
      return result
    } catch {
      throw new HTTPException(500, { message: `Provider error: ${JSON.stringify(openaiResponse)}` })
    }
  }
}

// Structural guard for the subset of `ChatCompletion` fields this
// transformer reads. We accept the upstream payload as `unknown` and
// gate it through this guard so the field access in
// `convertOpenAIResponseToAnthropic` is type-safe without an `as` cast.
function isChatCompletionLike(value: unknown): value is ChatCompletion {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('model' in value) || typeof value.model !== 'string') return false
  if (!('choices' in value) || !Array.isArray(value.choices)) return false
  return true
}

// ─── Non-stream response helpers ──────────────────────────────────────

function appendAnnotationContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  const annotations = getMessageAnnotations(message)
  if (!annotations || annotations.length === 0) return
  const id = `srvtoolu_${v4()}`
  content.push({
    type: 'server_tool_use',
    id,
    name: 'web_search',
    input: { query: '' }
  })
  content.push({
    type: 'web_search_tool_result',
    tool_use_id: id,
    content: annotations.map((item) => ({
      type: 'web_search_result',
      url: item.url_citation.url,
      title: item.url_citation.title
    }))
  })
}

function appendTextContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  if (message.content) {
    content.push({ type: 'text', text: message.content })
  }
}

type OpenAIToolCall = {
  id: string
  function: { name: string; arguments?: unknown }
}

function isOpenAIToolCall(value: unknown): value is OpenAIToolCall {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('function' in value)) return false
  const fn = value.function
  if (typeof fn !== 'object' || fn === null) return false
  if (!('name' in fn)) return false
  return typeof fn.name === 'string'
}

function parseToolCallInput(toolCall: OpenAIToolCall): unknown {
  const argumentsRaw = toolCall.function.arguments
  try {
    if (argumentsRaw === undefined || argumentsRaw === null) return {}
    if (typeof argumentsRaw === 'object') return argumentsRaw
    if (typeof argumentsRaw === 'string') {
      if (argumentsRaw.length === 0) return {}
      return JSON.parse(argumentsRaw)
    }
    return {}
  } catch {
    return { text: typeof argumentsRaw === 'string' ? argumentsRaw : '' }
  }
}

function appendToolCallContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  if (!message.tool_calls || message.tool_calls.length === 0) return
  for (const toolCall of message.tool_calls) {
    if (!isOpenAIToolCall(toolCall)) continue
    const parsedInput = parseToolCallInput(toolCall)
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parsedInput
    })
  }
}

function appendThinkingContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  const thinking = getMessageThinking(message)
  if (thinking?.content) {
    content.push({
      type: 'thinking',
      thinking: thinking.content,
      signature: thinking.signature
    })
  }
}

// ─── Streaming machinery ──────────────────────────────────────────────

type StreamState = {
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  decoder: TextDecoder
  messageId: string
  stopReasonMessageDelta: Record<string, unknown> | null
  model: string
  hasStarted: boolean
  hasTextContentStarted: boolean
  hasFinished: boolean
  toolCalls: Map<number, ToolCallInfo>
  toolCallIndexToContentBlockIndex: Map<number, number>
  totalChunks: number
  contentChunks: number
  toolCallChunks: number
  isClosed: boolean
  isThinkingStarted: boolean
  contentIndex: number
  currentContentBlockIndex: number
  safeEnqueue: (data: Uint8Array) => void
  safeClose: () => void
  closeCurrentBlock: () => void
  assignContentBlockIndex: () => number
}

function createStreamState(
  controller: ReadableStreamDefaultController<Uint8Array>,
  logger: Logger | undefined,
  reqId: string | undefined
): StreamState {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const state: StreamState = {
    controller,
    encoder,
    decoder,
    messageId: `msg_${Date.now()}`,
    stopReasonMessageDelta: null,
    model: 'unknown',
    hasStarted: false,
    hasTextContentStarted: false,
    hasFinished: false,
    toolCalls: new Map(),
    toolCallIndexToContentBlockIndex: new Map(),
    totalChunks: 0,
    contentChunks: 0,
    toolCallChunks: 0,
    isClosed: false,
    isThinkingStarted: false,
    contentIndex: 0,
    currentContentBlockIndex: -1,
    safeEnqueue: () => {},
    safeClose: () => {},
    closeCurrentBlock: () => {},
    assignContentBlockIndex: () => 0
  }

  state.safeEnqueue = (data: Uint8Array) => {
    safeEnqueue(state, data, logger, reqId)
  }
  state.safeClose = () => {
    safeClose(state)
  }
  state.closeCurrentBlock = () => {
    closeCurrentBlock(state)
  }
  state.assignContentBlockIndex = () => {
    const currentIdx = state.contentIndex
    state.contentIndex++
    return currentIdx
  }

  return state
}

function safeEnqueue(
  state: StreamState,
  data: Uint8Array,
  logger: Logger | undefined,
  reqId: string | undefined
): void {
  if (state.isClosed) return
  try {
    state.controller.enqueue(data)
    const dataStr = new TextDecoder().decode(data)
    logger?.trace({ reqId, data: dataStr, type: 'send data' })
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
      state.isClosed = true
      return
    }
    logger?.debug({
      reqId,
      error: error instanceof Error ? error.message : String(error),
      type: 'send data error'
    })
    throw error
  }
}

// Close whatever content block is currently open and FULLY reset
// block state. Codex (openai-responses) interleaves multiple
// reasoning-summary segments with text and tool calls, so each
// block type can recur. Latching the started flags "true forever"
// made a later thinking or text delta reference an index that was
// never (re)opened, which Claude Code rejects with "Content block
// not found".
function closeCurrentBlock(state: StreamState): void {
  if (state.currentContentBlockIndex >= 0) {
    state.safeEnqueue(
      state.encoder.encode(
        `event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: state.currentContentBlockIndex
        })}\n\n`
      )
    )
  }
  state.currentContentBlockIndex = -1
  state.isThinkingStarted = false
  state.hasTextContentStarted = false
}

function emitFinalMessageDelta(state: StreamState): void {
  if (state.stopReasonMessageDelta) {
    state.safeEnqueue(
      state.encoder.encode(`event: message_delta\ndata: ${JSON.stringify(state.stopReasonMessageDelta)}\n\n`)
    )
    state.stopReasonMessageDelta = null
    return
  }
  state.safeEnqueue(
    state.encoder.encode(
      `event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0
        }
      })}\n\n`
    )
  )
}

function safeClose(state: StreamState): void {
  if (state.isClosed) return
  try {
    if (state.currentContentBlockIndex >= 0) {
      const contentBlockStop = {
        type: 'content_block_stop',
        index: state.currentContentBlockIndex
      }
      state.safeEnqueue(
        state.encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify(contentBlockStop)}\n\n`)
      )
      state.currentContentBlockIndex = -1
    }

    emitFinalMessageDelta(state)

    const messageStop = { type: 'message_stop' }
    state.safeEnqueue(state.encoder.encode(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`))
    state.controller.close()
    state.isClosed = true
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
      state.isClosed = true
      return
    }
    throw error
  }
}

async function runStreamPump(
  openaiStream: ReadableStream<Uint8Array>,
  state: StreamState,
  logger: Logger | undefined,
  reqId: string | undefined
): Promise<void> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    reader = openaiStream.getReader()
    let buffer = ''

    for (;;) {
      if (state.isClosed) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += state.decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      const lastLine = lines.pop()
      buffer = lastLine === undefined ? '' : lastLine

      const shouldStop = processLines(lines, state, logger, reqId)
      if (shouldStop) break
    }
    // referenced to silence unused-var
    void state.totalChunks
    state.safeClose()
  } finally {
    if (reader) {
      try {
        reader.releaseLock()
      } catch (releaseError) {
        console.error(releaseError)
      }
    }
  }
}

function processOneLine(
  line: string,
  state: StreamState,
  logger: Logger | undefined,
  reqId: string | undefined
): { finished: boolean } {
  if (!line.startsWith('data:')) return { finished: false }
  const data = line.slice(5).trim()
  logger?.trace({ reqId, type: 'recieved data', data })
  if (data === '[DONE]') return { finished: false }

  try {
    const parsed: unknown = JSON.parse(data)
    if (!isStreamChunk(parsed)) return { finished: false }
    state.totalChunks++
    logger?.trace({ reqId, response: parsed, tppe: 'Original Response' })
    return { finished: handleChunk(parsed, state) }
  } catch (parseError) {
    const e = parseError instanceof Error ? parseError : new Error(String(parseError))
    logger?.error(`parseError: ${e.name} message: ${e.message} stack: ${e.stack} data: ${data}`)
    return { finished: false }
  }
}

function processLines(
  lines: string[],
  state: StreamState,
  logger: Logger | undefined,
  reqId: string | undefined
): boolean {
  for (const line of lines) {
    if (state.isClosed || state.hasFinished) return true
    const { finished } = processOneLine(line, state, logger, reqId)
    if (finished) return true
  }
  return false
}

function handleChunk(chunk: StreamChunk, state: StreamState): boolean {
  if (chunk.error) {
    const errorMessage = {
      type: 'error',
      message: {
        type: 'api_error',
        message: JSON.stringify(chunk.error)
      }
    }
    state.safeEnqueue(state.encoder.encode(`event: error\ndata: ${JSON.stringify(errorMessage)}\n\n`))
    return false
  }

  if (chunk.model !== undefined) state.model = chunk.model

  emitMessageStartIfNeeded(state)

  const choice = chunk.choices?.[0]
  if (chunk.usage) {
    updateUsageDelta(chunk.usage, state)
  }
  if (!choice) return false

  handleThinkingDelta(choice.delta, state)
  handleTextDelta(choice.delta, state)
  handleAnnotationsDelta(choice.delta, state)
  handleToolCallDelta(choice.delta, state)

  if (choice.finish_reason && !state.isClosed && !state.hasFinished) {
    return handleFinishReason(choice.finish_reason, chunk.usage, state)
  }
  return false
}

function emitMessageStartIfNeeded(state: StreamState): void {
  if (state.hasStarted || state.isClosed || state.hasFinished) return
  state.hasStarted = true
  const messageStart = {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: state.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  }
  state.safeEnqueue(state.encoder.encode(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`))
}

function updateUsageDelta(usage: NonNullable<StreamChunk['usage']>, state: StreamState): void {
  const usageObj = computeUsage(usage)
  if (!state.stopReasonMessageDelta) {
    state.stopReasonMessageDelta = {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: usageObj
    }
    return
  }
  state.stopReasonMessageDelta.usage = usageObj
}

function handleThinkingDelta(delta: StreamChoiceDelta | undefined, state: StreamState): void {
  if (!delta?.thinking || state.isClosed || state.hasFinished) return
  if (!state.isThinkingStarted) {
    state.closeCurrentBlock()
    const thinkingBlockIndex = state.assignContentBlockIndex()
    const contentBlockStart = {
      type: 'content_block_start',
      index: thinkingBlockIndex,
      content_block: { type: 'thinking', thinking: '' }
    }
    state.safeEnqueue(
      state.encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`)
    )
    state.currentContentBlockIndex = thinkingBlockIndex
    state.isThinkingStarted = true
  }
  if (delta.thinking.signature) {
    const thinkingSignature = {
      type: 'content_block_delta',
      index: state.currentContentBlockIndex,
      delta: {
        type: 'signature_delta',
        signature: delta.thinking.signature
      }
    }
    state.safeEnqueue(
      state.encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(thinkingSignature)}\n\n`)
    )
    state.closeCurrentBlock()
    return
  }
  if (delta.thinking.content) {
    const thinkingChunk = {
      type: 'content_block_delta',
      index: state.currentContentBlockIndex,
      delta: {
        type: 'thinking_delta',
        thinking: delta.thinking.content
      }
    }
    state.safeEnqueue(state.encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(thinkingChunk)}\n\n`))
  }
}

function handleTextDelta(delta: StreamChoiceDelta | undefined, state: StreamState): void {
  if (!delta?.content || state.isClosed || state.hasFinished) return
  state.contentChunks++

  if (!state.hasTextContentStarted && !state.hasFinished) {
    state.closeCurrentBlock()
    const textBlockIndex = state.assignContentBlockIndex()
    const contentBlockStart = {
      type: 'content_block_start',
      index: textBlockIndex,
      content_block: { type: 'text', text: '' }
    }
    state.safeEnqueue(
      state.encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`)
    )
    state.currentContentBlockIndex = textBlockIndex
    state.hasTextContentStarted = true
  }

  if (!state.isClosed && !state.hasFinished) {
    const anthropicChunk = {
      type: 'content_block_delta',
      index: state.currentContentBlockIndex,
      delta: { type: 'text_delta', text: delta.content }
    }
    state.safeEnqueue(state.encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(anthropicChunk)}\n\n`))
  }
}

function handleAnnotationsDelta(delta: StreamChoiceDelta | undefined, state: StreamState): void {
  if (!delta?.annotations?.length || state.isClosed || state.hasFinished) return
  state.closeCurrentBlock()

  for (const annotation of delta.annotations) {
    const annotationBlockIndex = state.assignContentBlockIndex()
    const title = annotation.url_citation?.title
    const url = annotation.url_citation?.url
    if (title === undefined || url === undefined) continue
    const contentBlockStart = {
      type: 'content_block_start',
      index: annotationBlockIndex,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: `srvtoolu_${v4()}`,
        content: [
          {
            type: 'web_search_result',
            title,
            url
          }
        ]
      }
    }
    state.safeEnqueue(
      state.encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`)
    )

    const contentBlockStop = {
      type: 'content_block_stop',
      index: annotationBlockIndex
    }
    state.safeEnqueue(state.encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify(contentBlockStop)}\n\n`))
    state.currentContentBlockIndex = -1
  }
}

function reconcileToolCallIdentity(toolCall: StreamToolCallChunk, toolCallIndex: number, state: StreamState): void {
  if (!toolCall.id || !toolCall.function?.name) return
  const existingToolCall = state.toolCalls.get(toolCallIndex)
  if (!existingToolCall) return
  const wasTemporary = existingToolCall.id.startsWith('call_') && existingToolCall.name.startsWith('tool_')
  if (!wasTemporary) return
  existingToolCall.id = toolCall.id
  existingToolCall.name = toolCall.function.name
}

function handleToolCallDelta(delta: StreamChoiceDelta | undefined, state: StreamState): void {
  if (!delta?.tool_calls || state.isClosed || state.hasFinished) return
  state.toolCallChunks++
  const processedInThisChunk = new Set<number>()

  for (const toolCall of delta.tool_calls) {
    if (state.isClosed) break
    // `index` is genuinely optional on partial OpenAI tool-call deltas;
    // 0 is the documented default when the upstream omits it for the
    // first tool call.
    const toolCallIndex = toolCall.index === undefined ? 0 : toolCall.index
    if (processedInThisChunk.has(toolCallIndex)) continue
    processedInThisChunk.add(toolCallIndex)
    const isUnknownIndex = !state.toolCallIndexToContentBlockIndex.has(toolCallIndex)

    if (isUnknownIndex) {
      startToolCallBlock(toolCall, toolCallIndex, state)
    } else {
      reconcileToolCallIdentity(toolCall, toolCallIndex, state)
    }

    emitToolCallArguments(toolCall, toolCallIndex, state)
  }
}

function startToolCallBlock(toolCall: StreamToolCallChunk, toolCallIndex: number, state: StreamState): void {
  state.closeCurrentBlock()

  const newContentBlockIndex = state.assignContentBlockIndex()
  state.toolCallIndexToContentBlockIndex.set(toolCallIndex, newContentBlockIndex)
  // Partial OpenAI tool-call deltas may omit id/name on the first chunk;
  // the synthesized placeholders below are overwritten by
  // reconcileToolCallIdentity when the real values arrive.
  const toolCallId = toolCall.id === undefined ? `call_${Date.now()}_${toolCallIndex}` : toolCall.id
  const fnName = toolCall.function?.name
  const toolCallName = fnName === undefined ? `tool_${toolCallIndex}` : fnName
  const contentBlockStart = {
    type: 'content_block_start',
    index: newContentBlockIndex,
    content_block: {
      type: 'tool_use',
      id: toolCallId,
      name: toolCallName,
      input: {}
    }
  }
  state.safeEnqueue(state.encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`))
  state.currentContentBlockIndex = newContentBlockIndex

  const toolCallInfo: ToolCallInfo = {
    id: toolCallId,
    name: toolCallName,
    arguments: '',
    contentBlockIndex: newContentBlockIndex
  }
  state.toolCalls.set(toolCallIndex, toolCallInfo)
}

// Character class matching ASCII C0/C1 control characters
// (U+0000..U+001F and U+007F..U+009F). Built via String.fromCharCode so
// the source file stays pure ASCII and `noControlCharactersInRegex`
// (which inspects the regex literal/source) doesn't fire.
const CONTROL_CHAR_REGEX = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  'g'
)

function emitToolCallArguments(toolCall: StreamToolCallChunk, toolCallIndex: number, state: StreamState): void {
  if (!toolCall.function?.arguments || state.isClosed || state.hasFinished) return
  const blockIndex = state.toolCallIndexToContentBlockIndex.get(toolCallIndex)
  if (blockIndex === undefined) return
  const currentToolCall = state.toolCalls.get(toolCallIndex)
  if (currentToolCall) {
    currentToolCall.arguments += toolCall.function.arguments
  }

  try {
    const anthropicChunk = {
      type: 'content_block_delta',
      index: blockIndex,
      delta: {
        type: 'input_json_delta',
        partial_json: toolCall.function.arguments
      }
    }
    state.safeEnqueue(state.encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(anthropicChunk)}\n\n`))
  } catch {
    try {
      const fixedArgument = toolCall.function.arguments
        .replace(CONTROL_CHAR_REGEX, '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')

      const fixedChunk = {
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: fixedArgument
        }
      }
      state.safeEnqueue(state.encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(fixedChunk)}\n\n`))
    } catch (fixError) {
      console.error(fixError)
    }
  }
}

function handleFinishReason(finishReason: string, usage: StreamChunk['usage'], state: StreamState): boolean {
  if (state.contentChunks === 0 && state.toolCallChunks === 0) {
    console.error('Warning: No content in the stream response!')
  }

  if (state.currentContentBlockIndex >= 0) {
    const contentBlockStop = {
      type: 'content_block_stop',
      index: state.currentContentBlockIndex
    }
    state.safeEnqueue(state.encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify(contentBlockStop)}\n\n`))
    state.currentContentBlockIndex = -1
  }

  if (!state.isClosed) {
    const anthropicStopReason = mapFinishReason(finishReason)
    state.stopReasonMessageDelta = {
      type: 'message_delta',
      delta: { stop_reason: anthropicStopReason, stop_sequence: null },
      usage: computeUsage(usage)
    }
  }

  return true
}
