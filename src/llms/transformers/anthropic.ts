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
import { v4 as uuidv4 } from 'uuid'
import type { RuntimeProvider, TransformerContext, UnifiedChatRequest, UnifiedMessage, UnifiedTool } from '../types'
import { formatBase64 } from '../utils/image'
import { getThinkLevel } from '../utils/thinking'
import { Transformer, type TransformerAuthResult } from './base'

interface AnthropicTransformerOptions {
  UseBearer?: boolean
}

interface AnthropicSystemBlock {
  type?: string
  text?: string
  cache_control?: unknown
}

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  cache_control?: unknown
  source?: { type?: string; data?: string; media_type?: string; url?: string }
  thinking?: string
  signature?: string
}

interface AnthropicIncomingMessage {
  role: 'user' | 'assistant' | string
  content: string | AnthropicContentBlock[]
}

interface AnthropicToolDef {
  name: string
  description?: string
  input_schema: UnifiedTool['function']['parameters']
}

interface AnthropicToolChoice {
  type: 'auto' | 'tool' | 'none' | 'required' | string
  name?: string
}

interface AnthropicIncomingRequest {
  model: string
  max_tokens?: number
  temperature?: number
  stream?: boolean
  system?: string | AnthropicSystemBlock[]
  messages?: AnthropicIncomingMessage[]
  tools?: AnthropicToolDef[]
  tool_choice?: AnthropicToolChoice
  thinking?: { type?: string; budget_tokens?: number }
}

interface StreamToolCallChunk {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface StreamChoiceDelta {
  content?: string
  thinking?: { content?: string; signature?: string }
  tool_calls?: StreamToolCallChunk[]
  annotations?: Array<{ url_citation?: { url?: string; title?: string } }>
}

interface StreamChunk {
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

interface ToolCallInfo {
  id: string
  name: string
  arguments: string
  contentBlockIndex: number
}

export class AnthropicTransformer extends Transformer {
  readonly name = 'anthropic'
  readonly endPoint = '/v1/messages'
  private readonly useBearer: boolean

  constructor(options?: AnthropicTransformerOptions) {
    super()
    this.useBearer = options?.UseBearer ?? false
  }

  async auth(
    request: unknown,
    provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<TransformerAuthResult> {
    const headers: Record<string, string | undefined> = {}

    if (this.useBearer) {
      headers['authorization'] = `Bearer ${provider.api_key}`
      headers['x-api-key'] = undefined
    } else {
      headers['x-api-key'] = provider.api_key
      headers['authorization'] = undefined
    }

    return {
      body: request,
      config: { headers }
    }
  }

  async transformRequestOut(request: unknown, _context: TransformerContext): Promise<UnifiedChatRequest> {
    const req = request as AnthropicIncomingRequest
    const messages: UnifiedMessage[] = []

    if (req.system) {
      if (typeof req.system === 'string') {
        messages.push({
          role: 'system',
          content: req.system
        })
      } else if (Array.isArray(req.system) && req.system.length) {
        const textParts = req.system
          .filter((item): item is AnthropicSystemBlock => item.type === 'text' && typeof item.text === 'string')
          .map((item) => ({
            type: 'text' as const,
            text: item.text as string,
            cache_control: item.cache_control as { type?: string } | undefined
          }))
        messages.push({
          role: 'system',
          content: textParts
        })
      }
    }

    const requestMessages = JSON.parse(JSON.stringify(req.messages || [])) as AnthropicIncomingMessage[]

    requestMessages.forEach((msg) => {
      if (msg.role !== 'user' && msg.role !== 'assistant') return

      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role,
          content: msg.content
        })
        return
      }

      if (!Array.isArray(msg.content)) return

      if (msg.role === 'user') {
        const toolParts = msg.content.filter((c) => c.type === 'tool_result' && c.tool_use_id)
        if (toolParts.length) {
          toolParts.forEach((tool) => {
            const toolMessage: UnifiedMessage = {
              role: 'tool',
              content: typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content),
              tool_call_id: tool.tool_use_id,
              cache_control: tool.cache_control as { type?: string } | undefined
            }
            messages.push(toolMessage)
          })
        }

        const textAndMediaParts = msg.content.filter(
          (c) => (c.type === 'text' && c.text) || (c.type === 'image' && c.source)
        )
        if (textAndMediaParts.length) {
          messages.push({
            role: 'user',
            content: textAndMediaParts.map((part) => {
              if (part.type === 'image' && part.source) {
                return {
                  type: 'image_url' as const,
                  image_url: {
                    url:
                      part.source.type === 'base64'
                        ? formatBase64(part.source.data ?? '', part.source.media_type ?? '')
                        : (part.source.url ?? '')
                  },
                  media_type: part.source.media_type ?? ''
                }
              }
              return {
                type: 'text' as const,
                text: part.text ?? ''
              }
            })
          })
        }
      } else {
        // assistant
        const assistantMessage: UnifiedMessage = {
          role: 'assistant',
          content: ''
        }
        const textParts = msg.content.filter((c) => c.type === 'text' && c.text)
        if (textParts.length) {
          assistantMessage.content = textParts.map((text) => text.text ?? '').join('\n')
        }

        const toolCallParts = msg.content.filter((c) => c.type === 'tool_use' && c.id)
        if (toolCallParts.length) {
          assistantMessage.tool_calls = toolCallParts.map((tool) => ({
            id: tool.id as string,
            type: 'function' as const,
            function: {
              name: tool.name ?? '',
              arguments: JSON.stringify(tool.input || {})
            }
          }))
        }

        const thinkingPart = msg.content.find((c) => c.type === 'thinking' && c.signature)
        if (thinkingPart) {
          assistantMessage.thinking = {
            content: thinkingPart.thinking ?? '',
            signature: thinkingPart.signature
          }
        }

        messages.push(assistantMessage)
      }
    })

    const result: UnifiedChatRequest = {
      messages,
      model: req.model,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      stream: req.stream,
      tools: req.tools?.length ? this.convertAnthropicToolsToUnified(req.tools) : undefined,
      tool_choice: undefined
    }
    if (req.thinking) {
      result.reasoning = {
        effort: getThinkLevel(req.thinking.budget_tokens ?? 0),
        enabled: req.thinking.type === 'enabled'
      }
    }
    if (req.tool_choice) {
      if (req.tool_choice.type === 'tool') {
        result.tool_choice = {
          type: 'function',
          function: { name: req.tool_choice.name ?? '' }
        }
      } else {
        result.tool_choice = req.tool_choice.type
      }
    }
    return result
  }

  async transformResponseIn(response: Response, context?: TransformerContext): Promise<Response> {
    const isStream = response.headers.get('Content-Type')?.includes('text/event-stream')
    if (isStream) {
      if (!response.body) {
        throw new Error('Stream response body is null')
      }
      const convertedStream = await this.convertOpenAIStreamToAnthropic(response.body, context!)
      return new Response(convertedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        }
      })
    } else {
      const data = (await response.json()) as ChatCompletion
      const anthropicResponse = this.convertOpenAIResponseToAnthropic(data, context!)
      return new Response(JSON.stringify(anthropicResponse), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  private convertAnthropicToolsToUnified(tools: AnthropicToolDef[]): UnifiedTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema
      }
    }))
  }

  private async convertOpenAIStreamToAnthropic(
    openaiStream: ReadableStream<Uint8Array>,
    context: TransformerContext
  ): Promise<ReadableStream<Uint8Array>> {
    const logger = this.logger
    const reqId = (context.req as { id?: string } | undefined)?.id

    const readable = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const encoder = new TextEncoder()
        const messageId = `msg_${Date.now()}`
        let stopReasonMessageDelta: null | Record<string, unknown> = null
        let model = 'unknown'
        let hasStarted = false
        let hasTextContentStarted = false
        const hasFinished = false
        const toolCalls = new Map<number, ToolCallInfo>()
        const toolCallIndexToContentBlockIndex = new Map<number, number>()
        let totalChunks = 0
        let contentChunks = 0
        let toolCallChunks = 0
        let isClosed = false
        let isThinkingStarted = false
        let contentIndex = 0
        let currentContentBlockIndex = -1

        const assignContentBlockIndex = (): number => {
          const currentIdx = contentIndex
          contentIndex++
          return currentIdx
        }

        const safeEnqueue = (data: Uint8Array) => {
          if (!isClosed) {
            try {
              controller.enqueue(data)
              const dataStr = new TextDecoder().decode(data)
              logger?.trace({
                reqId,
                data: dataStr,
                type: 'send data'
              })
            } catch (error) {
              if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
                isClosed = true
              } else {
                logger?.debug({
                  reqId,
                  error: error instanceof Error ? error.message : String(error),
                  type: 'send data error'
                })
                throw error
              }
            }
          }
        }

        // Close whatever content block is currently open and FULLY reset
        // block state. Codex (openai-responses) interleaves multiple
        // reasoning-summary segments with text and tool calls, so each
        // block type can recur. Latching the started flags "true forever"
        // made a later thinking or text delta reference an index that was
        // never (re)opened, which Claude Code rejects with "Content block
        // not found".
        const closeCurrentBlock = () => {
          if (currentContentBlockIndex >= 0) {
            safeEnqueue(
              encoder.encode(
                `event: content_block_stop\ndata: ${JSON.stringify({
                  type: 'content_block_stop',
                  index: currentContentBlockIndex
                })}\n\n`
              )
            )
          }
          currentContentBlockIndex = -1
          isThinkingStarted = false
          hasTextContentStarted = false
        }

        const safeClose = () => {
          if (!isClosed) {
            try {
              if (currentContentBlockIndex >= 0) {
                const contentBlockStop = {
                  type: 'content_block_stop',
                  index: currentContentBlockIndex
                }
                safeEnqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify(contentBlockStop)}\n\n`))
                currentContentBlockIndex = -1
              }

              if (stopReasonMessageDelta) {
                safeEnqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify(stopReasonMessageDelta)}\n\n`))
                stopReasonMessageDelta = null
              } else {
                safeEnqueue(
                  encoder.encode(
                    `event: message_delta\ndata: ${JSON.stringify({
                      type: 'message_delta',
                      delta: {
                        stop_reason: 'end_turn',
                        stop_sequence: null
                      },
                      usage: {
                        input_tokens: 0,
                        output_tokens: 0,
                        cache_read_input_tokens: 0
                      }
                    })}\n\n`
                  )
                )
              }
              const messageStop = { type: 'message_stop' }
              safeEnqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`))
              controller.close()
              isClosed = true
            } catch (error) {
              if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
                isClosed = true
              } else {
                throw error
              }
            }
          }
        }

        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

        try {
          reader = openaiStream.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            if (isClosed) break

            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (isClosed || hasFinished) break

              if (!line.startsWith('data:')) continue
              const data = line.slice(5).trim()
              logger?.trace({
                reqId,
                type: 'recieved data',
                data
              })

              if (data === '[DONE]') continue

              try {
                const chunk = JSON.parse(data) as StreamChunk
                totalChunks++
                logger?.trace({
                  reqId,
                  response: chunk,
                  tppe: 'Original Response'
                })
                if (chunk.error) {
                  const errorMessage = {
                    type: 'error',
                    message: {
                      type: 'api_error',
                      message: JSON.stringify(chunk.error)
                    }
                  }
                  safeEnqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(errorMessage)}\n\n`))
                  continue
                }

                model = chunk.model || model

                if (!hasStarted && !isClosed && !hasFinished) {
                  hasStarted = true
                  const messageStart = {
                    type: 'message_start',
                    message: {
                      id: messageId,
                      type: 'message',
                      role: 'assistant',
                      content: [],
                      model,
                      stop_reason: null,
                      stop_sequence: null,
                      usage: { input_tokens: 0, output_tokens: 0 }
                    }
                  }
                  safeEnqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`))
                }

                const choice = chunk.choices?.[0]
                if (chunk.usage) {
                  const inputTokens =
                    (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0)
                  const outputTokens = chunk.usage.completion_tokens || 0
                  const cacheRead = chunk.usage.prompt_tokens_details?.cached_tokens || 0
                  if (!stopReasonMessageDelta) {
                    stopReasonMessageDelta = {
                      type: 'message_delta',
                      delta: { stop_reason: 'end_turn', stop_sequence: null },
                      usage: {
                        input_tokens: inputTokens,
                        output_tokens: outputTokens,
                        cache_read_input_tokens: cacheRead
                      }
                    }
                  } else {
                    ;(stopReasonMessageDelta as { usage: unknown }).usage = {
                      input_tokens: inputTokens,
                      output_tokens: outputTokens,
                      cache_read_input_tokens: cacheRead
                    }
                  }
                }
                if (!choice) continue

                if (choice.delta?.thinking && !isClosed && !hasFinished) {
                  if (!isThinkingStarted) {
                    closeCurrentBlock()
                    const thinkingBlockIndex = assignContentBlockIndex()
                    const contentBlockStart = {
                      type: 'content_block_start',
                      index: thinkingBlockIndex,
                      content_block: { type: 'thinking', thinking: '' }
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`)
                    )
                    currentContentBlockIndex = thinkingBlockIndex
                    isThinkingStarted = true
                  }
                  if (choice.delta.thinking.signature) {
                    const thinkingSignature = {
                      type: 'content_block_delta',
                      index: currentContentBlockIndex,
                      delta: {
                        type: 'signature_delta',
                        signature: choice.delta.thinking.signature
                      }
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(thinkingSignature)}\n\n`)
                    )
                    closeCurrentBlock()
                  } else if (choice.delta.thinking.content) {
                    const thinkingChunk = {
                      type: 'content_block_delta',
                      index: currentContentBlockIndex,
                      delta: {
                        type: 'thinking_delta',
                        thinking: choice.delta.thinking.content || ''
                      }
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(thinkingChunk)}\n\n`)
                    )
                  }
                }

                if (choice.delta?.content && !isClosed && !hasFinished) {
                  contentChunks++

                  if (!hasTextContentStarted && !hasFinished) {
                    closeCurrentBlock()
                    const textBlockIndex = assignContentBlockIndex()
                    const contentBlockStart = {
                      type: 'content_block_start',
                      index: textBlockIndex,
                      content_block: { type: 'text', text: '' }
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`)
                    )
                    currentContentBlockIndex = textBlockIndex
                    hasTextContentStarted = true
                  }

                  if (!isClosed && !hasFinished) {
                    const anthropicChunk = {
                      type: 'content_block_delta',
                      index: currentContentBlockIndex,
                      delta: {
                        type: 'text_delta',
                        text: choice.delta.content
                      }
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(anthropicChunk)}\n\n`)
                    )
                  }
                }

                if (choice.delta?.annotations?.length && !isClosed && !hasFinished) {
                  closeCurrentBlock()

                  choice.delta.annotations.forEach((annotation) => {
                    const annotationBlockIndex = assignContentBlockIndex()
                    const contentBlockStart = {
                      type: 'content_block_start',
                      index: annotationBlockIndex,
                      content_block: {
                        type: 'web_search_tool_result',
                        tool_use_id: `srvtoolu_${uuidv4()}`,
                        content: [
                          {
                            type: 'web_search_result',
                            title: annotation.url_citation?.title ?? '',
                            url: annotation.url_citation?.url ?? ''
                          }
                        ]
                      }
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`)
                    )

                    const contentBlockStop = {
                      type: 'content_block_stop',
                      index: annotationBlockIndex
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify(contentBlockStop)}\n\n`)
                    )
                    currentContentBlockIndex = -1
                  })
                }

                if (choice.delta?.tool_calls && !isClosed && !hasFinished) {
                  toolCallChunks++
                  const processedInThisChunk = new Set<number>()

                  for (const toolCall of choice.delta.tool_calls) {
                    if (isClosed) break
                    const toolCallIndex = toolCall.index ?? 0
                    if (processedInThisChunk.has(toolCallIndex)) continue
                    processedInThisChunk.add(toolCallIndex)
                    const isUnknownIndex = !toolCallIndexToContentBlockIndex.has(toolCallIndex)

                    if (isUnknownIndex) {
                      closeCurrentBlock()

                      const newContentBlockIndex = assignContentBlockIndex()
                      toolCallIndexToContentBlockIndex.set(toolCallIndex, newContentBlockIndex)
                      const toolCallId = toolCall.id || `call_${Date.now()}_${toolCallIndex}`
                      const toolCallName = toolCall.function?.name || `tool_${toolCallIndex}`
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
                      safeEnqueue(
                        encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`)
                      )
                      currentContentBlockIndex = newContentBlockIndex

                      const toolCallInfo: ToolCallInfo = {
                        id: toolCallId,
                        name: toolCallName,
                        arguments: '',
                        contentBlockIndex: newContentBlockIndex
                      }
                      toolCalls.set(toolCallIndex, toolCallInfo)
                    } else if (toolCall.id && toolCall.function?.name) {
                      const existingToolCall = toolCalls.get(toolCallIndex)
                      if (existingToolCall) {
                        const wasTemporary =
                          existingToolCall.id.startsWith('call_') && existingToolCall.name.startsWith('tool_')
                        if (wasTemporary) {
                          existingToolCall.id = toolCall.id
                          existingToolCall.name = toolCall.function.name
                        }
                      }
                    }

                    if (toolCall.function?.arguments && !isClosed && !hasFinished) {
                      const blockIndex = toolCallIndexToContentBlockIndex.get(toolCallIndex)
                      if (blockIndex === undefined) continue
                      const currentToolCall = toolCalls.get(toolCallIndex)
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
                        safeEnqueue(
                          encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(anthropicChunk)}\n\n`)
                        )
                      } catch {
                        try {
                          const fixedArgument = toolCall.function.arguments
                            // eslint-disable-next-line no-control-regex
                            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
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
                          safeEnqueue(
                            encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(fixedChunk)}\n\n`)
                          )
                        } catch (fixError) {
                          console.error(fixError)
                        }
                      }
                    }
                  }
                }

                if (choice.finish_reason && !isClosed && !hasFinished) {
                  if (contentChunks === 0 && toolCallChunks === 0) {
                    console.error('Warning: No content in the stream response!')
                  }

                  if (currentContentBlockIndex >= 0) {
                    const contentBlockStop = {
                      type: 'content_block_stop',
                      index: currentContentBlockIndex
                    }
                    safeEnqueue(
                      encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify(contentBlockStop)}\n\n`)
                    )
                    currentContentBlockIndex = -1
                  }

                  if (!isClosed) {
                    const stopReasonMapping: Record<string, string> = {
                      stop: 'end_turn',
                      length: 'max_tokens',
                      tool_calls: 'tool_use',
                      content_filter: 'stop_sequence'
                    }
                    const anthropicStopReason = stopReasonMapping[choice.finish_reason] || 'end_turn'
                    stopReasonMessageDelta = {
                      type: 'message_delta',
                      delta: { stop_reason: anthropicStopReason, stop_sequence: null },
                      usage: {
                        input_tokens:
                          (chunk.usage?.prompt_tokens || 0) - (chunk.usage?.prompt_tokens_details?.cached_tokens || 0),
                        output_tokens: chunk.usage?.completion_tokens || 0,
                        cache_read_input_tokens: chunk.usage?.prompt_tokens_details?.cached_tokens || 0
                      }
                    }
                  }

                  break
                }
              } catch (parseError) {
                const e = parseError as Error
                logger?.error(`parseError: ${e.name} message: ${e.message} stack: ${e.stack} data: ${data}`)
              }
            }
          }
          // referenced to silence unused-var
          void totalChunks
          safeClose()
        } catch (error) {
          if (!isClosed) {
            try {
              controller.error(error)
            } catch (controllerError) {
              console.error(controllerError)
            }
          }
        } finally {
          if (reader) {
            try {
              reader.releaseLock()
            } catch (releaseError) {
              console.error(releaseError)
            }
          }
        }
      },
      cancel: (reason) => {
        logger?.debug({ reqId }, `cancle stream: ${String(reason)}`)
      }
    })

    return readable
  }

  private convertOpenAIResponseToAnthropic(
    openaiResponse: ChatCompletion,
    context: TransformerContext
  ): Record<string, unknown> {
    const reqId = (context.req as { id?: string } | undefined)?.id
    this.logger?.debug({ reqId, response: openaiResponse }, `Original OpenAI response`)
    try {
      const choice = openaiResponse.choices[0]
      if (!choice) {
        throw new Error('No choices found in OpenAI response')
      }
      const content: Array<Record<string, unknown>> = []
      const annotations = (choice.message as { annotations?: Array<{ url_citation: { url: string; title: string } }> })
        .annotations
      if (annotations) {
        const id = `srvtoolu_${uuidv4()}`
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
      if (choice.message.content) {
        content.push({
          type: 'text',
          text: choice.message.content
        })
      }
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        choice.message.tool_calls.forEach((toolCall) => {
          let parsedInput: unknown = {}
          try {
            const fnTool = toolCall as { function?: { arguments?: unknown } }
            const argumentsStr = fnTool.function?.arguments ?? '{}'

            if (typeof argumentsStr === 'object') {
              parsedInput = argumentsStr
            } else if (typeof argumentsStr === 'string') {
              parsedInput = JSON.parse(argumentsStr)
            }
          } catch {
            const fnTool = toolCall as { function?: { arguments?: unknown } }
            parsedInput = { text: fnTool.function?.arguments || '' }
          }

          const fnTool = toolCall as { id: string; function: { name: string } }
          content.push({
            type: 'tool_use',
            id: fnTool.id,
            name: fnTool.function.name,
            input: parsedInput
          })
        })
      }
      const thinking = (choice.message as { thinking?: { content?: string; signature?: string } }).thinking
      if (thinking?.content) {
        content.push({
          type: 'thinking',
          thinking: thinking.content,
          signature: thinking.signature
        })
      }
      const result = {
        id: openaiResponse.id,
        type: 'message',
        role: 'assistant',
        model: openaiResponse.model,
        content,
        stop_reason:
          choice.finish_reason === 'stop'
            ? 'end_turn'
            : choice.finish_reason === 'length'
              ? 'max_tokens'
              : choice.finish_reason === 'tool_calls'
                ? 'tool_use'
                : choice.finish_reason === 'content_filter'
                  ? 'stop_sequence'
                  : 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens:
            (openaiResponse.usage?.prompt_tokens || 0) -
            (openaiResponse.usage?.prompt_tokens_details?.cached_tokens || 0),
          output_tokens: openaiResponse.usage?.completion_tokens || 0,
          cache_read_input_tokens: openaiResponse.usage?.prompt_tokens_details?.cached_tokens || 0
        }
      }
      this.logger?.debug({ reqId, result }, `Conversion complete, final Anthropic response`)
      return result
    } catch {
      throw new HTTPException(500, { message: `Provider error: ${JSON.stringify(openaiResponse)}` })
    }
  }
}
