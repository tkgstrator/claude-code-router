/**
 * OpenAI Responses-API endpoint transformer.
 *
 * Owns `/v1/responses`. Reshapes the unified request into the Responses
 * input/instructions/tools shape and converts the Responses-style
 * (streaming or JSON) reply back into the chat-completions shape the
 * rest of the pipeline expects.
 */

import type { MessageContent, TransformerContext, UnifiedChatRequest } from '../types'
import { Transformer } from './base'

interface ResponsesAPIOutputContent {
  type: string
  text?: string
  image_url?: string
  mime_type?: string
  image_base64?: string
  annotations?: Array<{
    url?: string
    title?: string
    start_index?: number
    end_index?: number
  }>
}

interface ResponsesAPIOutputItem {
  type: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: ResponsesAPIOutputContent[]
  reasoning?: string
}

interface ResponsesAPIPayload {
  id?: string
  object?: string
  model?: string
  created_at?: number
  output?: ResponsesAPIOutputItem[]
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
}

interface ResponsesStreamItem {
  id?: string
  type?: string
  call_id?: string
  name?: string
  content?: Array<{ type: string; text?: string; image_url?: string; mime_type?: string }>
  reasoning?: string
}

interface ResponsesStreamEvent {
  type: string
  item_id?: string
  output_index?: number
  delta?: string | { url?: string; b64_json?: string; mime_type?: string }
  item?: ResponsesStreamItem
  response?: {
    id?: string
    model?: string
    output?: Array<{ type: string }>
  }
  annotation?: {
    url?: string
    title?: string
    start_index?: number
    end_index?: number
  }
  part?: unknown
  reasoning_summary?: string
}

interface ResponsesUnifiedChatRequest extends UnifiedChatRequest {
  instructions?: string
  input?: unknown[]
  parallel_tool_calls?: boolean
}

export class OpenAIResponsesTransformer extends Transformer {
  readonly name = 'openai-responses'
  readonly endPoint = '/v1/responses'

  async transformRequestIn(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    const responsesReq = request as ResponsesUnifiedChatRequest
    delete responsesReq.temperature
    delete responsesReq.max_tokens

    // Handle the reasoning parameter
    if (responsesReq.reasoning) {
      ;(responsesReq as unknown as { reasoning: Record<string, unknown> }).reasoning = {
        effort: responsesReq.reasoning.effort,
        summary: 'detailed'
      }
    }

    const input: unknown[] = []

    const systemMessages = responsesReq.messages.filter((msg) => msg.role === 'system')
    if (systemMessages.length > 0) {
      const firstSystem = systemMessages[0]
      if (Array.isArray(firstSystem.content)) {
        firstSystem.content.forEach((item) => {
          let text = ''
          if (typeof item === 'string') {
            text = item
          } else if (item && typeof item === 'object' && 'text' in item) {
            text = (item as { text: string }).text
          }
          input.push({
            role: 'system',
            content: text
          })
        })
      } else {
        responsesReq.instructions = typeof firstSystem.content === 'string' ? firstSystem.content : undefined
      }
    }

    responsesReq.messages.forEach((message) => {
      if (message.role === 'system') return

      if (Array.isArray(message.content)) {
        const convertedContent = message.content
          .map((content) => this.normalizeRequestContent(content, message.role))
          .filter((content): content is Record<string, unknown> => content !== null)

        if (convertedContent.length > 0) {
          ;(message as unknown as { content: unknown }).content = convertedContent
        } else {
          delete (message as { content?: unknown }).content
        }
      }

      if (message.role === 'tool') {
        const toolMessage: Record<string, unknown> = { ...message }
        toolMessage.type = 'function_call_output'
        toolMessage.call_id = message.tool_call_id
        toolMessage.output = message.content
        delete toolMessage.cache_control
        delete toolMessage.role
        delete toolMessage.tool_call_id
        delete toolMessage.content
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
      delete (message as { thinking?: unknown }).thinking
      delete (message as { cache_control?: unknown }).cache_control

      input.push(message)
    })

    responsesReq.input = input
    delete (responsesReq as { messages?: unknown }).messages

    if (Array.isArray(responsesReq.tools)) {
      const webSearch = responsesReq.tools.find((tool) => tool.function.name === 'web_search')

      const remapped: unknown[] = responsesReq.tools
        .filter((tool) => tool.function.name !== 'web_search')
        .map((tool) => {
          if (tool.function.name === 'WebSearch') {
            delete (tool.function.parameters.properties as Record<string, unknown>).allowed_domains
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

      ;(responsesReq as unknown as { tools: unknown }).tools = remapped
    }

    responsesReq.parallel_tool_calls = false

    return responsesReq
  }

  async transformResponseOut(response: Response, _context: TransformerContext): Promise<Response> {
    const contentType = response.headers.get('Content-Type') || ''

    if (contentType.includes('application/json')) {
      const jsonResponse = (await response.json()) as ResponsesAPIPayload

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
    } else if (contentType.includes('text/event-stream')) {
      if (!response.body) {
        return response
      }

      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      let isStreamEnded = false

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader()

          // Index tracker - only incremented when the event type changes
          let currentIndex = -1
          let lastEventType = ''

          const getCurrentIndex = (eventType: string): number => {
            if (eventType !== lastEventType) {
              currentIndex++
              lastEventType = eventType
            }
            return currentIndex
          }

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                if (!isStreamEnded) {
                  const doneChunk = `data: [DONE]\n\n`
                  controller.enqueue(encoder.encode(doneChunk))
                }
                break
              }

              const chunk = decoder.decode(value, { stream: true })
              buffer += chunk

              const lines = buffer.split(/\r?\n/)
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (!line.trim()) continue

                try {
                  if (line.startsWith('event: ')) {
                    // ignore
                  } else if (line.startsWith('data: ')) {
                    const dataStr = line.slice(5).trim()
                    if (dataStr === '[DONE]') {
                      isStreamEnded = true
                      controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
                      continue
                    }

                    try {
                      const data: ResponsesStreamEvent = JSON.parse(dataStr)

                      if (data.type === 'response.output_text.delta') {
                        const chatChunk = {
                          id: data.item_id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model,
                          choices: [
                            {
                              index: getCurrentIndex(data.type),
                              delta: {
                                content: typeof data.delta === 'string' ? data.delta : ''
                              },
                              finish_reason: null
                            }
                          ]
                        }
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatChunk)}\n\n`))
                      } else if (data.type === 'response.output_item.added' && data.item?.type === 'function_call') {
                        const functionCallChunk = {
                          id: data.item.call_id || data.item.id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model || 'gpt-5-codex-',
                          choices: [
                            {
                              index: getCurrentIndex(data.type),
                              delta: {
                                role: 'assistant',
                                tool_calls: [
                                  {
                                    index: 0,
                                    id: data.item.call_id || data.item.id,
                                    function: {
                                      name: data.item.name || '',
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
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(functionCallChunk)}\n\n`))
                      } else if (data.type === 'response.output_item.added' && data.item?.type === 'message') {
                        const contentItems: MessageContent[] = []
                        ;(data.item.content || []).forEach((item) => {
                          if (item.type === 'output_text') {
                            contentItems.push({
                              type: 'text',
                              text: item.text || ''
                            })
                          }
                        })

                        const delta: { role: string; content?: string | MessageContent[] } = { role: 'assistant' }
                        if (contentItems.length === 1 && contentItems[0].type === 'text') {
                          delta.content = contentItems[0].text
                        } else if (contentItems.length > 0) {
                          delta.content = contentItems
                        }
                        if (delta.content) {
                          const messageChunk = {
                            id: data.item.id || 'chatcmpl-' + Date.now(),
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: data.response?.model,
                            choices: [
                              {
                                index: getCurrentIndex(data.type),
                                delta,
                                finish_reason: null
                              }
                            ]
                          }
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(messageChunk)}\n\n`))
                        }
                      } else if (data.type === 'response.output_text.annotation.added') {
                        const annotationChunk = {
                          id: data.item_id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model || 'gpt-5-codex',
                          choices: [
                            {
                              index: getCurrentIndex(data.type),
                              delta: {
                                annotations: [
                                  {
                                    type: 'url_citation',
                                    url_citation: {
                                      url: data.annotation?.url || '',
                                      title: data.annotation?.title || '',
                                      content: '',
                                      start_index: data.annotation?.start_index || 0,
                                      end_index: data.annotation?.end_index || 0
                                    }
                                  }
                                ]
                              },
                              finish_reason: null
                            }
                          ]
                        }
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(annotationChunk)}\n\n`))
                      } else if (data.type === 'response.function_call_arguments.delta') {
                        const functionCallChunk = {
                          id: data.item_id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model || 'gpt-5-codex-',
                          choices: [
                            {
                              index: getCurrentIndex(data.type),
                              delta: {
                                tool_calls: [
                                  {
                                    index: 0,
                                    function: {
                                      arguments: typeof data.delta === 'string' ? data.delta : ''
                                    }
                                  }
                                ]
                              },
                              finish_reason: null
                            }
                          ]
                        }
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(functionCallChunk)}\n\n`))
                      } else if (data.type === 'response.completed') {
                        const finishReason = data.response?.output?.some((item) => item.type === 'function_call')
                          ? 'tool_calls'
                          : 'stop'

                        const endChunk = {
                          id: data.response?.id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model || 'gpt-5-codex-',
                          choices: [
                            {
                              index: 0,
                              delta: {},
                              finish_reason: finishReason
                            }
                          ]
                        }
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`))
                        isStreamEnded = true
                      } else if (data.type === 'response.reasoning_summary_text.delta') {
                        const thinkingChunk = {
                          id: data.item_id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model,
                          choices: [
                            {
                              index: getCurrentIndex(data.type),
                              delta: {
                                thinking: {
                                  content: typeof data.delta === 'string' ? data.delta : ''
                                }
                              },
                              finish_reason: null
                            }
                          ]
                        }
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(thinkingChunk)}\n\n`))
                      } else if (data.type === 'response.reasoning_summary_part.done' && data.part) {
                        const thinkingChunk = {
                          id: data.item_id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model,
                          choices: [
                            {
                              index: currentIndex,
                              delta: {
                                thinking: {
                                  signature: data.item_id
                                }
                              },
                              finish_reason: null
                            }
                          ]
                        }
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(thinkingChunk)}\n\n`))
                      }
                    } catch {
                      // On JSON parse failure, pass the original line through
                      controller.enqueue(encoder.encode(line + '\n'))
                    }
                  } else {
                    // Pass remaining lines through unchanged
                    controller.enqueue(encoder.encode(line + '\n'))
                  }
                } catch (error) {
                  console.error('Error processing line:', line, error)
                  controller.enqueue(encoder.encode(line + '\n'))
                }
              }
            }

            if (buffer.trim()) {
              controller.enqueue(encoder.encode(buffer + '\n'))
            }

            if (!isStreamEnded) {
              const doneChunk = `data: [DONE]\n\n`
              controller.enqueue(encoder.encode(doneChunk))
            }
          } catch (error) {
            console.error('Stream error:', error)
            controller.error(error)
          } finally {
            try {
              reader.releaseLock()
            } catch (e) {
              console.error('Error releasing reader lock:', e)
            }
            controller.close()
          }
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

    return response
  }

  private normalizeRequestContent(
    content: { type?: string; text?: string; image_url?: { url?: string }; cache_control?: unknown },
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
    let annotations: Array<Record<string, unknown>> | undefined
    if (messageOutput?.content?.length && messageOutput.content[0].annotations) {
      annotations = messageOutput.content[0].annotations.map((item) => ({
        type: 'url_citation',
        url_citation: {
          url: item.url || '',
          title: item.title || '',
          content: '',
          start_index: item.start_index || 0,
          end_index: item.end_index || 0
        }
      }))
    }

    this.logger?.debug({
      data: annotations,
      type: 'url_citation'
    })

    let messageContent: string | MessageContent[] | null = null
    let toolCalls: Array<Record<string, unknown>> | null = null
    let thinking: { content: string } | null = null

    if (messageOutput && messageOutput.reasoning) {
      thinking = { content: messageOutput.reasoning }
    }

    if (messageOutput && messageOutput.content) {
      const textParts: string[] = []
      const imageParts: MessageContent[] = []

      messageOutput.content.forEach((item) => {
        if (item.type === 'output_text') {
          textParts.push(item.text || '')
        } else if (item.type === 'output_image') {
          const imageContent = this.buildImageContent({
            url: item.image_url,
            mime_type: item.mime_type
          })
          if (imageContent) imageParts.push(imageContent)
        } else if (item.type === 'output_image_base64') {
          const imageContent = this.buildImageContent({
            b64_json: item.image_base64,
            mime_type: item.mime_type
          })
          if (imageContent) imageParts.push(imageContent)
        }
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
        messageContent = contentArray
      } else {
        messageContent = textParts.join('')
      }
    }

    if (functionCallOutput) {
      toolCalls = [
        {
          id: functionCallOutput.call_id || functionCallOutput.id,
          function: {
            name: functionCallOutput.name,
            arguments: functionCallOutput.arguments
          },
          type: 'function'
        }
      ]
    }

    const chatResponse = {
      id: responseData.id || 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: responseData.created_at,
      model: responseData.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: messageContent || null,
            tool_calls: toolCalls,
            thinking,
            annotations
          },
          logprobs: null,
          finish_reason: toolCalls ? 'tool_calls' : 'stop'
        }
      ],
      usage: responseData.usage
        ? {
            prompt_tokens: responseData.usage.input_tokens || 0,
            completion_tokens: responseData.usage.output_tokens || 0,
            total_tokens: responseData.usage.total_tokens || 0
          }
        : null
    }

    return chatResponse
  }

  private buildImageContent(source: { url?: string; b64_json?: string; mime_type?: string }): MessageContent | null {
    if (!source) return null

    if (source.url || source.b64_json) {
      return {
        type: 'image_url',
        image_url: {
          url: source.url || '',
          b64_json: source.b64_json
        },
        media_type: source.mime_type
      } as unknown as MessageContent
    }

    return null
  }
}
