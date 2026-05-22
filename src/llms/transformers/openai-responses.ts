/**
 * OpenAI Responses-API endpoint transformer.
 *
 * Owns `/v1/responses`. Reshapes the unified request into the Responses
 * input/instructions/tools shape and converts the Responses-style
 * (streaming or JSON) reply back into the chat-completions shape the
 * rest of the pipeline expects.
 */

import { HTTPException } from 'hono/http-exception'
import type {
  MessageContent,
  ResponsesAPIOutputContent,
  ResponsesAPIOutputItem,
  ResponsesAPIPayload,
  ResponsesStreamEvent,
  ResponsesStreamItem,
  ResponsesUnifiedChatRequest,
  RuntimeProvider,
  TransformerContext,
  TransformerHookResult,
  UnifiedChatRequest
} from '@/schemas'
import { ResponsesAPIPayloadSchema, ResponsesStreamEventSchema } from '@/schemas'
import { Transformer } from './base'

type StreamIndexState = {
  index: number
  lastEventType: string
}

type MutableMessage = Record<string, unknown>

type RequestContentBlock = {
  type?: string
  text?: string
  image_url?: { url?: string }
  cache_control?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTextWrapper(value: unknown): value is { text: string } {
  return isObject(value) && typeof value.text === 'string'
}

function isRequestContentBlock(value: unknown): value is RequestContentBlock {
  return isObject(value)
}

function setField(target: MutableMessage, key: string, value: unknown): void {
  target[key] = value
}

function deleteField(target: MutableMessage, key: string): void {
  delete target[key]
}

function newChatcmplId(seed: string | undefined): string {
  if (seed && seed.length > 0) return seed
  return `chatcmpl-${Date.now()}`
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function stringDeltaOrEmpty(delta: ResponsesStreamEvent['delta']): string {
  return typeof delta === 'string' ? delta : ''
}

/**
 * Return the first defined string from a candidate list. Used to
 * select an upstream identifier (call_id, id) without a `??` chain.
 */
function firstDefined(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Returns the provided model name or the fallback placeholder used by
 * the original transformer when upstream omitted it. Keeps the wire
 * shape stable for downstream consumers that expect a non-empty model.
 */
function modelOr(model: string | undefined, fallback: string): string {
  return typeof model === 'string' && model.length > 0 ? model : fallback
}

export class OpenAIResponsesTransformer extends Transformer {
  readonly name = 'openai-responses'
  readonly endPoint = '/v1/responses'

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider?: RuntimeProvider
  ): Promise<TransformerHookResult | UnifiedChatRequest> {
    // biome-ignore plugin: structural widening — Responses augments UnifiedChatRequest with optional fields (instructions/input/parallel_tool_calls) that we mutate in-place; the unified schema cannot model these without breaking other transformers.
    const responsesReq = request as ResponsesUnifiedChatRequest
    delete responsesReq.temperature
    delete responsesReq.max_tokens
    // Defence in depth — an earlier chain step (OpenAITransformer) may have
    // renamed max_tokens to max_completion_tokens for newer gpt-5.x models.
    // Responses API uses neither; drop it.
    delete (responsesReq as { max_completion_tokens?: unknown }).max_completion_tokens

    this.rewriteReasoning(responsesReq)

    const input: unknown[] = []
    this.collectSystemMessages(responsesReq, input)

    for (const message of responsesReq.messages) {
      if (message.role === 'system') continue
      this.processNonSystemMessage(message, input)
    }

    responsesReq.input = input
    // biome-ignore plugin: the Responses API rejects `messages` — must be removed before sending; the unified schema does not model field removal.
    delete (responsesReq as { messages?: unknown }).messages

    if (Array.isArray(responsesReq.tools)) {
      const remapped = this.remapTools(responsesReq.tools)
      // biome-ignore plugin: the Responses API uses a flat `type/name/parameters` tool shape (no nested `function`); the unified UnifiedTool shape is reshaped here on the way out.
      ;(responsesReq as unknown as { tools: unknown }).tools = remapped
    }

    responsesReq.parallel_tool_calls = false

    // Redirect to the Responses endpoint when the provider's
    // api_base_url points at /chat/completions. The codex subscription
    // provider's base URL is the ChatGPT backend root (no /chat/completions
    // segment), so this is a no-op there and codex-oauth still appends
    // /responses itself further down the chain.
    const base = provider?.api_base_url ?? ''
    if (base.includes('/chat/completions')) {
      const url = base.replace('/chat/completions', '/responses')
      return { body: responsesReq, config: { url } }
    }

    return responsesReq
  }

  private rewriteReasoning(responsesReq: ResponsesUnifiedChatRequest): void {
    if (!responsesReq.reasoning) return
    const effort = responsesReq.reasoning.effort
    // biome-ignore plugin: rewriting `reasoning` to the Responses-API `{effort, summary}` shape — the unified type narrows it as `{effort, max_tokens, enabled}` only.
    ;(responsesReq as unknown as { reasoning: Record<string, unknown> }).reasoning = {
      effort,
      summary: 'detailed'
    }
  }

  private collectSystemMessages(responsesReq: ResponsesUnifiedChatRequest, input: unknown[]): void {
    const systemMessages = responsesReq.messages.filter((msg) => msg.role === 'system')
    if (systemMessages.length === 0) return

    const firstSystem = systemMessages[0]
    if (Array.isArray(firstSystem.content)) {
      firstSystem.content.forEach((item) => {
        let text = ''
        if (typeof item === 'string') {
          text = item
        } else if (isTextWrapper(item)) {
          text = item.text
        }
        input.push({ role: 'system', content: text })
      })
    } else {
      responsesReq.instructions = typeof firstSystem.content === 'string' ? firstSystem.content : undefined
    }
  }

  private processNonSystemMessage(message: UnifiedChatRequest['messages'][number], input: unknown[]): void {
    // The message is already an object — narrow it for mutation without `as`.
    if (!isObject(message)) return
    const mutable: MutableMessage = message

    if (Array.isArray(message.content)) {
      const convertedContent = message.content
        .map((content) => (isRequestContentBlock(content) ? this.normalizeRequestContent(content, message.role) : null))
        .filter((content): content is Record<string, unknown> => content !== null)

      if (convertedContent.length > 0) {
        setField(mutable, 'content', convertedContent)
      } else {
        deleteField(mutable, 'content')
      }
    }

    if (message.role === 'tool') {
      const toolMessage: MutableMessage = { ...mutable }
      toolMessage.type = 'function_call_output'
      toolMessage.call_id = message.tool_call_id
      toolMessage.output = message.content
      deleteField(toolMessage, 'cache_control')
      deleteField(toolMessage, 'role')
      deleteField(toolMessage, 'tool_call_id')
      deleteField(toolMessage, 'content')
      input.push(toolMessage)
      return
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      message.tool_calls.forEach((tool) => {
        input.push({
          type: 'function_call',
          arguments: tool.function.arguments,
          name: tool.function.name,
          call_id: tool.id
        })
      })
      return
    }

    // The Responses API strictly validates every `input[]` item and
    // rejects unknown fields with 400 "Unknown parameter:
    // 'input[N].thinking'". An Anthropic-format assistant turn that
    // came through the passthrough path still carries `thinking`
    // (extended-reasoning block) and a message-level `cache_control`,
    // neither of which the Responses schema accepts. Strip them
    // before the raw message reaches the input array — the reasoning
    // is replayed separately via the top-level `reasoning` param.
    deleteField(mutable, 'thinking')
    deleteField(mutable, 'cache_control')

    input.push(message)
  }

  private remapTools(tools: UnifiedChatRequest['tools']): unknown[] {
    if (!Array.isArray(tools)) return []
    const webSearch = tools.find((tool) => tool.function.name === 'web_search')

    const remapped: unknown[] = tools
      .filter((tool) => tool.function.name !== 'web_search')
      .map((tool) => {
        if (tool.function.name === 'WebSearch') {
          const properties = tool.function.parameters.properties
          if (isObject(properties)) {
            delete properties.allowed_domains
          }
        }
        if (tool.function.name === 'Edit') {
          return {
            type: tool.type,
            name: tool.function.name,
            description: tool.function.description,
            parameters: {
              ...tool.function.parameters,
              required: ['file_path', 'old_string', 'new_string', 'replace_all']
            },
            strict: true
          }
        }
        return {
          type: tool.type,
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
      })

    if (webSearch) {
      remapped.push({ type: 'web_search' })
    }

    return remapped
  }

  async transformResponseOut(response: Response, _context: TransformerContext): Promise<Response> {
    const contentType = response.headers.get('Content-Type')
    if (typeof contentType !== 'string') return response

    if (contentType.includes('application/json')) {
      return this.handleJsonResponse(response)
    }

    if (contentType.includes('text/event-stream')) {
      return this.handleStreamResponse(response)
    }

    return response
  }

  private async handleJsonResponse(response: Response): Promise<Response> {
    const raw = await response.json()
    const parsed = ResponsesAPIPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      throw new HTTPException(500, {
        message: `Invalid OpenAI Responses payload: ${JSON.stringify(parsed.error.issues)}`
      })
    }
    const jsonResponse = parsed.data

    // Check whether the JSON response is in the responses API format
    if (jsonResponse.object === 'response' && jsonResponse.output) {
      const chatResponse = this.convertResponseToChat(jsonResponse)
      return new Response(JSON.stringify(chatResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    }

    return new Response(JSON.stringify(jsonResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }

  private handleStreamResponse(response: Response): Response {
    if (!response.body) {
      return response
    }

    const upstreamBody = response.body
    const transformer = this

    const stream = new ReadableStream({
      async start(controller) {
        const session = new ResponsesStreamSession(controller, transformer)
        await session.run(upstreamBody.getReader())
      }
    })

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  /** Public accessor so the stream session can dispatch SSE events. */
  dispatchStreamEvent(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number,
    enqueueChunk: (chunk: unknown) => void
  ): boolean {
    return this.handleStreamEvent(data, getCurrentIndex, enqueueChunk)
  }

  /**
   * Translates a single Responses-API SSE event into the chat-completion
   * chunk(s) the rest of the pipeline expects. Returns `true` when the
   * event indicates the stream is complete (so callers can suppress the
   * extra synthetic `[DONE]`).
   */
  private handleStreamEvent(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number,
    enqueueChunk: (chunk: unknown) => void
  ): boolean {
    switch (data.type) {
      case 'response.output_text.delta':
        enqueueChunk(this.buildTextDeltaChunk(data, getCurrentIndex))
        return false
      case 'response.output_item.added':
        if (data.item?.type === 'function_call') {
          enqueueChunk(this.buildFunctionCallAddedChunk(data, getCurrentIndex))
        } else if (data.item?.type === 'message') {
          const chunk = this.buildMessageAddedChunk(data, getCurrentIndex)
          if (chunk) enqueueChunk(chunk)
        }
        return false
      case 'response.output_text.annotation.added':
        enqueueChunk(this.buildAnnotationChunk(data, getCurrentIndex))
        return false
      case 'response.function_call_arguments.delta':
        enqueueChunk(this.buildFunctionArgsDeltaChunk(data, getCurrentIndex))
        return false
      case 'response.completed':
        enqueueChunk(this.buildCompletedChunk(data))
        return true
      case 'response.reasoning_summary_text.delta':
        enqueueChunk(this.buildReasoningDeltaChunk(data, getCurrentIndex))
        return false
      case 'response.reasoning_summary_part.done':
        if (data.part) enqueueChunk(this.buildReasoningSignatureChunk(data, getCurrentIndex))
        return false
      default:
        return false
    }
  }

  private buildTextDeltaChunk(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number
  ): Record<string, unknown> {
    return {
      id: newChatcmplId(data.item_id),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: data.response?.model,
      choices: [
        {
          index: getCurrentIndex(data.type),
          delta: { content: stringDeltaOrEmpty(data.delta) },
          finish_reason: null
        }
      ]
    }
  }

  private buildFunctionCallAddedChunk(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number
  ): Record<string, unknown> {
    const item = data.item
    const toolName = item?.name
    if (toolName === undefined) {
      throw new HTTPException(500, {
        message: 'OpenAI Responses stream: function_call output is missing name'
      })
    }
    const callId = firstDefined([item?.call_id, item?.id])
    return {
      id: newChatcmplId(callId),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: modelOr(data.response?.model, 'gpt-5-codex-'),
      choices: [
        {
          index: getCurrentIndex(data.type),
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: callId,
                function: {
                  name: toolName,
                  arguments: ''
                },
                type: 'function'
              }
            ]
          },
          finish_reason: null
        }
      ]
    }
  }

  private buildMessageAddedChunk(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number
  ): Record<string, unknown> | null {
    const item = data.item
    if (!item) return null

    const contentItems: MessageContent[] = []
    const itemContent = item.content
    if (Array.isArray(itemContent)) {
      itemContent.forEach((entry) => {
        if (entry.type === 'output_text' && typeof entry.text === 'string') {
          contentItems.push({
            type: 'text',
            text: entry.text
          })
        }
      })
    }

    const delta: { role: string; content?: string | MessageContent[] } = { role: 'assistant' }
    if (contentItems.length === 1 && contentItems[0].type === 'text') {
      delta.content = contentItems[0].text
    } else if (contentItems.length > 0) {
      delta.content = contentItems
    }
    if (!delta.content) return null

    return {
      id: newChatcmplId(item.id),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: data.response?.model,
      choices: [
        {
          index: getCurrentIndex(data.type),
          delta,
          finish_reason: null
        }
      ]
    }
  }

  private buildAnnotationChunk(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number
  ): Record<string, unknown> {
    // ResponsesAnnotationSchema fills missing fields with empty
    // defaults; if `annotation` itself is undefined we synthesise a
    // schema-shaped placeholder so the downstream emit stays uniform.
    const empty = { url: '', title: '', start_index: 0, end_index: 0 }
    const annotation = data.annotation ? data.annotation : empty
    return {
      id: newChatcmplId(data.item_id),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: modelOr(data.response?.model, 'gpt-5-codex'),
      choices: [
        {
          index: getCurrentIndex(data.type),
          delta: {
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  url: annotation.url,
                  title: annotation.title,
                  content: '',
                  start_index: annotation.start_index,
                  end_index: annotation.end_index
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    }
  }

  private buildFunctionArgsDeltaChunk(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number
  ): Record<string, unknown> {
    return {
      id: newChatcmplId(data.item_id),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: modelOr(data.response?.model, 'gpt-5-codex-'),
      choices: [
        {
          index: getCurrentIndex(data.type),
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: stringDeltaOrEmpty(data.delta)
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    }
  }

  private buildCompletedChunk(data: ResponsesStreamEvent): Record<string, unknown> {
    const finishReason = data.response?.output?.some((item) => item.type === 'function_call') ? 'tool_calls' : 'stop'
    return {
      id: newChatcmplId(data.response?.id),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: modelOr(data.response?.model, 'gpt-5-codex-'),
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason
        }
      ]
    }
  }

  private buildReasoningDeltaChunk(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number
  ): Record<string, unknown> {
    return {
      id: newChatcmplId(data.item_id),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: data.response?.model,
      choices: [
        {
          index: getCurrentIndex(data.type),
          delta: {
            thinking: {
              content: stringDeltaOrEmpty(data.delta)
            }
          },
          finish_reason: null
        }
      ]
    }
  }

  private buildReasoningSignatureChunk(
    data: ResponsesStreamEvent,
    getCurrentIndex: (eventType: string) => number
  ): Record<string, unknown> {
    // Use the same index as the most recent reasoning_summary_text delta
    // (the original code reused `currentIndex` without bumping). This
    // helper inspects the tracker without mutating it by passing the
    // type that already advanced it.
    return {
      id: newChatcmplId(data.item_id),
      object: 'chat.completion.chunk',
      created: nowSeconds(),
      model: data.response?.model,
      choices: [
        {
          index: getCurrentIndex('response.reasoning_summary_text.delta'),
          delta: {
            thinking: {
              signature: data.item_id
            }
          },
          finish_reason: null
        }
      ]
    }
  }

  private normalizeRequestContent(
    content: RequestContentBlock,
    role: string | undefined
  ): Record<string, unknown> | null {
    const clone: Record<string, unknown> = { ...content }
    delete clone.cache_control

    if (content.type === 'text') {
      return {
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: content.text
      }
    }

    if (content.type === 'image_url') {
      const imagePayload: Record<string, unknown> = {
        type: role === 'assistant' ? 'output_image' : 'input_image'
      }

      if (typeof content.image_url?.url === 'string') {
        imagePayload.image_url = content.image_url.url
      }

      return imagePayload
    }

    return null
  }

  private convertResponseToChat(responseData: ResponsesAPIPayload): Record<string, unknown> {
    const messageOutput = responseData.output?.find((item) => item.type === 'message')
    const functionCallOutput = responseData.output?.find((item) => item.type === 'function_call')
    const annotations = this.buildAnnotationsFromMessage(messageOutput)

    this.logger?.debug({
      data: annotations,
      type: 'url_citation'
    })

    const thinking = messageOutput?.reasoning ? { content: messageOutput.reasoning } : null
    const messageContent = this.buildMessageContentFromOutput(messageOutput)
    const toolCalls = functionCallOutput
      ? [
          {
            id: firstDefined([functionCallOutput.call_id, functionCallOutput.id]),
            function: {
              name: functionCallOutput.name,
              arguments: functionCallOutput.arguments
            },
            type: 'function'
          }
        ]
      : null

    const usage = responseData.usage
      ? {
          prompt_tokens: responseData.usage.input_tokens,
          completion_tokens: responseData.usage.output_tokens,
          total_tokens: responseData.usage.total_tokens
        }
      : null

    return {
      id: newChatcmplId(responseData.id),
      object: 'chat.completion',
      created: responseData.created_at,
      model: responseData.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: messageContent,
            tool_calls: toolCalls,
            thinking,
            annotations
          },
          logprobs: null,
          finish_reason: toolCalls ? 'tool_calls' : 'stop'
        }
      ],
      usage
    }
  }

  private buildAnnotationsFromMessage(
    messageOutput: ResponsesAPIOutputItem | undefined
  ): Array<Record<string, unknown>> | undefined {
    const firstAnnotations = messageOutput?.content?.[0]?.annotations
    if (!firstAnnotations || firstAnnotations.length === 0) return undefined
    // ResponsesAnnotationSchema fills missing fields with defaults
    // (`''`/0), so each item is read directly here.
    return firstAnnotations.map((item) => ({
      type: 'url_citation',
      url_citation: {
        url: item.url,
        title: item.title,
        content: '',
        start_index: item.start_index,
        end_index: item.end_index
      }
    }))
  }

  private buildMessageContentFromOutput(
    messageOutput: ResponsesAPIOutputItem | undefined
  ): string | MessageContent[] | null {
    if (!messageOutput?.content) return null

    const textParts: string[] = []
    const imageParts: MessageContent[] = []

    messageOutput.content.forEach((item) => {
      this.collectContentItem(item, textParts, imageParts)
    })

    if (imageParts.length > 0) {
      const contentArray: MessageContent[] = []
      if (textParts.length > 0) {
        contentArray.push({
          type: 'text',
          text: textParts.join('')
        })
      }
      contentArray.push(...imageParts)
      return contentArray
    }

    const joined = textParts.join('')
    return joined === '' ? null : joined
  }

  private collectContentItem(item: ResponsesAPIOutputContent, textParts: string[], imageParts: MessageContent[]): void {
    if (item.type === 'output_text') {
      if (typeof item.text === 'string') textParts.push(item.text)
      return
    }
    if (item.type === 'output_image') {
      const imageContent = this.buildImageContent({
        url: item.image_url,
        mime_type: item.mime_type
      })
      if (imageContent) imageParts.push(imageContent)
      return
    }
    if (item.type === 'output_image_base64') {
      const imageContent = this.buildImageContent({
        b64_json: item.image_base64,
        mime_type: item.mime_type
      })
      if (imageContent) imageParts.push(imageContent)
    }
  }

  private buildImageContent(source: { url?: string; b64_json?: string; mime_type?: string }): MessageContent | null {
    if (!source.url && !source.b64_json) return null
    if (typeof source.mime_type !== 'string' || source.mime_type === '') return null

    const url = source.url
    if (typeof url !== 'string' || url === '') return null

    // The shared `ImageContent` schema only models a URL-form image_url;
    // the base64 fallback is a Responses-API extension we synthesise
    // here. When only b64_json is available, callers must encode it
    // into a data: URL upstream.
    const content: MessageContent = {
      type: 'image_url',
      image_url: { url },
      media_type: source.mime_type
    }
    return content
  }
}

// Silence unused-type lint for the streaming inner item type re-exported
// from schemas — kept for editor IntelliSense on the SSE branch.
export type { ResponsesStreamItem }

/**
 * Buffered SSE parser that drives the upstream Responses-API stream.
 *
 * Encapsulating this as a class keeps `handleStreamResponse` flat (one
 * `await session.run(...)` call) and lets each chunk-processing branch
 * sit at its own method-level cognitive complexity score.
 */
class ResponsesStreamSession {
  private readonly controller: ReadableStreamDefaultController<Uint8Array>
  private readonly transformer: OpenAIResponsesTransformer
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private buffer = ''
  private isStreamEnded = false
  private readonly indexState: StreamIndexState = { index: -1, lastEventType: '' }

  constructor(controller: ReadableStreamDefaultController<Uint8Array>, transformer: OpenAIResponsesTransformer) {
    this.controller = controller
    this.transformer = transformer
  }

  async run(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      await this.consume(reader)
      if (this.buffer.trim()) {
        this.enqueueRaw(this.buffer)
      }
      if (!this.isStreamEnded) {
        this.controller.enqueue(this.encoder.encode(`data: [DONE]\n\n`))
      }
    } catch (error) {
      console.error('Stream error:', error)
      this.controller.error(error)
    } finally {
      try {
        reader.releaseLock()
      } catch (e) {
        console.error('Error releasing reader lock:', e)
      }
      this.controller.close()
    }
  }

  private async consume(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        if (!this.isStreamEnded) {
          this.controller.enqueue(this.encoder.encode(`data: [DONE]\n\n`))
        }
        return
      }
      this.buffer += this.decoder.decode(value, { stream: true })
      const lines = this.buffer.split(/\r?\n/)
      const remainder = lines.pop()
      this.buffer = typeof remainder === 'string' ? remainder : ''
      for (const line of lines) {
        this.processLine(line)
      }
    }
  }

  private processLine(line: string): void {
    if (!line.trim()) return
    try {
      if (line.startsWith('event: ')) return
      if (!line.startsWith('data: ')) {
        this.enqueueRaw(line)
        return
      }
      this.processDataLine(line)
    } catch (error) {
      console.error('Error processing line:', line, error)
      this.enqueueRaw(line)
    }
  }

  private processDataLine(line: string): void {
    const dataStr = line.slice(5).trim()
    if (dataStr === '[DONE]') {
      this.isStreamEnded = true
      this.controller.enqueue(this.encoder.encode(`data: [DONE]\n\n`))
      return
    }
    const parsed = this.safeParseEvent(dataStr)
    if (!parsed) {
      this.enqueueRaw(line)
      return
    }
    const ended = this.transformer.dispatchStreamEvent(
      parsed,
      (eventType) => this.bumpIndex(eventType),
      (chunk) => this.enqueueChunk(chunk)
    )
    if (ended) this.isStreamEnded = true
  }

  private safeParseEvent(dataStr: string): ResponsesStreamEvent | null {
    let raw: unknown
    try {
      raw = JSON.parse(dataStr)
    } catch {
      return null
    }
    const result = ResponsesStreamEventSchema.safeParse(raw)
    return result.success ? result.data : null
  }

  private bumpIndex(eventType: string): number {
    if (eventType !== this.indexState.lastEventType) {
      this.indexState.index++
      this.indexState.lastEventType = eventType
    }
    return this.indexState.index
  }

  private enqueueChunk(obj: unknown): void {
    this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
  }

  private enqueueRaw(text: string): void {
    this.controller.enqueue(this.encoder.encode(`${text}\n`))
  }
}
