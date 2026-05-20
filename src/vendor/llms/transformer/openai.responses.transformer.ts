import type { MessageContent, UnifiedChatRequest } from '@/llms/types/llm'
import type { Transformer } from '@/llms/types/transformer'

interface ResponsesAPIOutputItem {
  type: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{
    type: string
    text?: string
    image_url?: string
    mime_type?: string
    image_base64?: string
  }>
  reasoning?: string
}

interface ResponsesAPIPayload {
  id: string
  object: string
  model: string
  created_at: number
  output: ResponsesAPIOutputItem[]
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
}

interface ResponsesStreamEvent {
  type: string
  item_id?: string
  output_index?: number
  delta?:
    | string
    | {
        url?: string
        b64_json?: string
        mime_type?: string
      }
  item?: {
    id?: string
    type?: string
    call_id?: string
    name?: string
    content?: Array<{
      type: string
      text?: string
      image_url?: string
      mime_type?: string
    }>
    reasoning?: string // Adds support for the reasoning field
  }
  response?: {
    id?: string
    model?: string
    output?: Array<{
      type: string
    }>
  }
  reasoning_summary?: string // Adds support for reasoning summaries
}

export class OpenAIResponsesTransformer implements Transformer {
  name = 'openai-responses'
  endPoint = '/v1/responses'

  async transformRequestIn(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    delete request.temperature
    delete request.max_tokens

    // Handle the reasoning parameter
    if (request.reasoning) {
      ;(request as any).reasoning = {
        effort: request.reasoning.effort,
        summary: 'detailed'
      }
    }

    const input: any[] = []

    const systemMessages = request.messages.filter((msg) => msg.role === 'system')
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
        ;(request as any).instructions = firstSystem.content
      }
    }

    request.messages.forEach((message) => {
      if (message.role === 'system') return

      if (Array.isArray(message.content)) {
        const convertedContent = message.content
          .map((content) => this.normalizeRequestContent(content, message.role))
          .filter((content): content is Record<string, unknown> => content !== null)

        if (convertedContent.length > 0) {
          ;(message as any).content = convertedContent
        } else {
          delete (message as any).content
        }
      }

      if (message.role === 'tool') {
        const toolMessage: any = { ...message }
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
      delete (message as any).thinking
      delete (message as any).cache_control

      input.push(message)
    })

    ;(request as any).input = input
    delete (request as any).messages

    if (Array.isArray(request.tools)) {
      const webSearch = request.tools.find((tool) => tool.function.name === 'web_search')

      ;(request as any).tools = request.tools
        .filter((tool) => tool.function.name !== 'web_search')
        .map((tool) => {
          if (tool.function.name === 'WebSearch') {
            delete tool.function.parameters.properties.allowed_domains
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
        ;(request as any).tools.push({
          type: 'web_search'
        })
      }
    }

    request.parallel_tool_calls = false

    return request
  }

  async transformResponseOut(response: Response): Promise<Response> {
    const contentType = response.headers.get('Content-Type') || ''

    if (contentType.includes('application/json')) {
      const jsonResponse: any = await response.json()

      // Check whether the JSON response is in the responses API format
      if (jsonResponse.object === 'response' && jsonResponse.output) {
        // Convert the responses format into the chat format
        const chatResponse = this.convertResponseToChat(jsonResponse)
        return new Response(JSON.stringify(chatResponse), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        })
      }

      // Not the responses API format - leave it untouched
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
      let buffer = '' // Buffers incomplete data
      let isStreamEnded = false

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader()

          // Index tracker - only incremented when the event type changes
          let currentIndex = -1
          let lastEventType = ''

          // Helper that returns the index to use right now
          const getCurrentIndex = (eventType: string) => {
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
                  // Emit the terminator marker
                  const doneChunk = `data: [DONE]\n\n`
                  controller.enqueue(encoder.encode(doneChunk))
                }
                break
              }

              const chunk = decoder.decode(value, { stream: true })
              buffer += chunk

              // Process every complete line currently in the buffer
              const lines = buffer.split(/\r?\n/)
              buffer = lines.pop() || '' // The last entry may be incomplete - keep it buffered

              for (const line of lines) {
                if (!line.trim()) continue

                try {
                  if (line.startsWith('event: ')) {
                  } else if (line.startsWith('data: ')) {
                    const dataStr = line.slice(5).trim() // Strip the "data: " prefix
                    if (dataStr === '[DONE]') {
                      isStreamEnded = true
                      controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
                      continue
                    }

                    try {
                      const data: ResponsesStreamEvent = JSON.parse(dataStr)

                      // Convert each event type to the chat format
                      if (data.type === 'response.output_text.delta') {
                        // Convert output_text.delta into the chat format
                        const chatChunk = {
                          id: data.item_id || 'chatcmpl-' + Date.now(),
                          object: 'chat.completion.chunk',
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model,
                          choices: [
                            {
                              index: getCurrentIndex(data.type),
                              delta: {
                                content: data.delta || ''
                              },
                              finish_reason: null
                            }
                          ]
                        }

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatChunk)}\n\n`))
                      } else if (data.type === 'response.output_item.added' && data.item?.type === 'function_call') {
                        // Handle the start of a function call - create the initial tool-call chunk
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
                        // Handle the message-item-added event
                        const contentItems: MessageContent[] = []
                        ;(data.item.content || []).forEach((item: any) => {
                          if (item.type === 'output_text') {
                            contentItems.push({
                              type: 'text',
                              text: item.text || ''
                            })
                          }
                        })

                        const delta: any = { role: 'assistant' }
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
                        // Handle function-call argument deltas
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
                                      arguments: data.delta || ''
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
                        // Emit the terminator marker - check whether this completes the tool_calls
                        const finishReason = data.response?.output?.some((item: any) => item.type === 'function_call')
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
                        // Handle reasoning text by converting it into the thinking-delta format
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
                                  content: data.delta || ''
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
                    } catch (e) {
                      // On JSON parse failure, pass the original line through
                      controller.enqueue(encoder.encode(line + '\n'))
                    }
                  } else {
                    // Pass remaining lines through unchanged
                    controller.enqueue(encoder.encode(line + '\n'))
                  }
                } catch (error) {
                  console.error('Error processing line:', line, error)
                  // On parse failure, pass the original line through unchanged
                  controller.enqueue(encoder.encode(line + '\n'))
                }
              }
            }

            // Process any remaining data left in the buffer
            if (buffer.trim()) {
              controller.enqueue(encoder.encode(buffer + '\n'))
            }

            // Ensure the terminator marker is emitted when the stream ends
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

  private normalizeRequestContent(content: any, role: string | undefined) {
    // Clone the content object and strip its cache-control fields
    const clone = { ...content }
    delete clone.cache_control

    if (content.type === 'text') {
      return {
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: content.text
      }
    }

    if (content.type === 'image_url') {
      console.log(content)
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

  private convertResponseToChat(responseData: ResponsesAPIPayload): any {
    // Extract the various output types from the output array
    const messageOutput = responseData.output?.find((item) => item.type === 'message')
    const functionCallOutput = responseData.output?.find((item) => item.type === 'function_call')
    let annotations
    if (messageOutput?.content?.length && messageOutput?.content[0].annotations) {
      annotations = messageOutput.content[0].annotations.map((item) => {
        return {
          type: 'url_citation',
          url_citation: {
            url: item.url || '',
            title: item.title || '',
            content: '',
            start_index: item.start_index || 0,
            end_index: item.end_index || 0
          }
        }
      })
    }

    this.logger.debug({
      data: annotations,
      type: 'url_citation'
    })

    let messageContent: string | MessageContent[] | null = null
    let toolCalls = null
    let thinking = null

    // Handle reasoning content
    if (messageOutput && messageOutput.reasoning) {
      thinking = {
        content: messageOutput.reasoning
      }
    }

    if (messageOutput && messageOutput.content) {
      // Separate the text and image content
      const textParts: string[] = []
      const imageParts: MessageContent[] = []

      messageOutput.content.forEach((item: any) => {
        if (item.type === 'output_text') {
          textParts.push(item.text || '')
        } else if (item.type === 'output_image') {
          const imageContent = this.buildImageContent({
            url: item.image_url,
            mime_type: item.mime_type
          })
          if (imageContent) {
            imageParts.push(imageContent)
          }
        } else if (item.type === 'output_image_base64') {
          const imageContent = this.buildImageContent({
            b64_json: item.image_base64,
            mime_type: item.mime_type
          })
          if (imageContent) {
            imageParts.push(imageContent)
          }
        }
      })

      // Build the final content payload
      if (imageParts.length > 0) {
        // When images are present, combine everything into an array
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
        // When only text is present, return it as a string
        messageContent = textParts.join('')
      }
    }

    if (functionCallOutput) {
      // Handle outputs of the function_call type
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

    // Assemble the chat-formatted response
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
            thinking: thinking,
            annotations: annotations
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
      } as MessageContent
    }

    return null
  }
}
