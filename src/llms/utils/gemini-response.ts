/**
 * Gemini → OpenAI-shaped response conversion.
 *
 * Converts both blocking JSON responses and SSE streams emitted by the
 * Gemini `generateContent` / `streamGenerateContent` endpoints into the
 * pipeline's internal OpenAI-flavoured shape (chat completion + chunk).
 */

import type { Part } from '@google/genai'
import type { Logger } from 'pino'
import type { Annotation } from '../types'

// ─── Gemini response shapes (subset we read) ────────────────────────────

interface GeminiUsageMetadata {
  candidatesTokenCount?: number
  promptTokenCount?: number
  cachedContentTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
}

interface GeminiGroundingSupport {
  groundingChunkIndices?: number[]
  segment?: {
    text?: string
    startIndex?: number
    endIndex?: number
  }
}

interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string }
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundingChunk[]
  groundingSupports?: GeminiGroundingSupport[]
}

interface GeminiCandidate {
  content?: { parts?: Part[] }
  finishReason?: string
  groundingMetadata?: GeminiGroundingMetadata
}

interface GeminiResponse {
  candidates: GeminiCandidate[]
  responseId?: string
  modelVersion?: string
  usageMetadata?: GeminiUsageMetadata
}

interface GeminiStreamChunk extends GeminiResponse {
  modelVersion: string
}

// ─── Pipeline output shapes ─────────────────────────────────────────────

interface PipelineToolCall {
  id: string
  type: 'function'
  function: {
    name: string | undefined
    arguments: string
  }
}

interface PipelineToolCallDelta extends PipelineToolCall {
  index: number
}

interface PipelineDelta {
  role: 'assistant'
  content?: string | null
  thinking?: { content?: string; signature?: string }
  tool_calls?: PipelineToolCallDelta[]
  annotations?: Annotation[]
}

interface PipelineChunkChoice {
  delta: PipelineDelta
  finish_reason: string | null
  index: number
  logprobs: null
}

interface PipelineChunkUsage {
  completion_tokens: number
  prompt_tokens: number
  prompt_tokens_details: { cached_tokens: number }
  total_tokens: number
  output_tokens_details: { reasoning_tokens: number }
}

interface PipelineStreamChunk {
  choices: PipelineChunkChoice[]
  created: number
  id: string
  model: string
  object: 'chat.completion.chunk'
  system_fingerprint: string
  usage?: PipelineChunkUsage
}

const buildAnnotations = (candidate: GeminiCandidate): Annotation[] | undefined => {
  const grounding = candidate.groundingMetadata
  if (!grounding?.groundingChunks?.length) {
    return undefined
  }
  return grounding.groundingChunks.map<Annotation>((groundingChunk, index) => {
    const support = grounding.groundingSupports?.filter((item) => item.groundingChunkIndices?.includes(index))
    return {
      type: 'url_citation',
      url_citation: {
        url: groundingChunk?.web?.uri || '',
        title: groundingChunk?.web?.title || '',
        content: support?.[0]?.segment?.text || '',
        start_index: support?.[0]?.segment?.startIndex || 0,
        end_index: support?.[0]?.segment?.endIndex || 0
      }
    }
  })
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/**
 * Translate a Gemini blocking JSON response or SSE stream into the
 * internal OpenAI-shaped response. Preserves the upstream status,
 * status text, and headers verbatim.
 */
export async function transformResponseOut(
  response: Response,
  providerName: string,
  logger?: Logger
): Promise<Response> {
  if (response.headers.get('Content-Type')?.includes('application/json')) {
    const jsonResponse = (await response.json()) as GeminiResponse
    logger?.debug({ response: jsonResponse }, `${providerName} response:`)

    // Extract thinking content from parts with thought: true
    let thinkingContent = ''
    let thinkingSignature = ''

    const parts: Part[] = jsonResponse.candidates[0]?.content?.parts || []
    const nonThinkingParts: Part[] = []

    for (const part of parts) {
      if (part.text && part.thought === true) {
        thinkingContent += part.text
      } else {
        nonThinkingParts.push(part)
      }
    }

    // Get thoughtSignature from functionCall args or usageMetadata
    thinkingSignature = parts.find((part: Part) => part.thoughtSignature)?.thoughtSignature ?? ''

    const tool_calls: PipelineToolCall[] =
      nonThinkingParts
        ?.filter((part: Part) => part.functionCall)
        ?.map((part: Part) => ({
          id: part.functionCall?.id || `tool_${Math.random().toString(36).substring(2, 15)}`,
          type: 'function' as const,
          function: {
            name: part.functionCall?.name,
            arguments: JSON.stringify(part.functionCall?.args || {})
          }
        })) || []

    const textContent =
      nonThinkingParts
        ?.filter((part: Part) => part.text)
        ?.map((part: Part) => part.text)
        ?.join('\n') || ''

    const res = {
      id: jsonResponse.responseId,
      choices: [
        {
          finish_reason: (jsonResponse.candidates[0].finishReason as string | undefined)?.toLowerCase() || null,
          index: 0,
          message: {
            content: textContent,
            role: 'assistant',
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
            // Add thinking as separate field if available
            ...(thinkingSignature && {
              thinking: {
                content: thinkingContent || '(no content)',
                signature: thinkingSignature
              }
            })
          }
        }
      ],
      created: nowSeconds(),
      model: jsonResponse.modelVersion,
      object: 'chat.completion',
      usage: {
        completion_tokens: jsonResponse.usageMetadata?.candidatesTokenCount || 0,
        prompt_tokens: jsonResponse.usageMetadata?.promptTokenCount || 0,
        prompt_tokens_details: {
          cached_tokens: jsonResponse.usageMetadata?.cachedContentTokenCount || 0
        },
        total_tokens: jsonResponse.usageMetadata?.totalTokenCount || 0,
        output_tokens_details: {
          reasoning_tokens: jsonResponse.usageMetadata?.thoughtsTokenCount || 0
        }
      }
    }
    return new Response(JSON.stringify(res), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  } else if (response.headers.get('Content-Type')?.includes('stream')) {
    if (!response.body) {
      return response
    }

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let signatureSent = false
    let contentSent = false
    let hasThinkingContent = false
    let pendingContent = ''
    let contentIndex = 0
    let toolCallIndex = -1

    const stream = new ReadableStream({
      async start(controller) {
        const processLine = async (
          line: string,
          controller: ReadableStreamDefaultController<Uint8Array>
        ): Promise<void> => {
          if (line.startsWith('data: ')) {
            const chunkStr = line.slice(6).trim()
            if (chunkStr) {
              logger?.debug({ chunkStr }, `${providerName} chunk:`)
              try {
                const chunk = JSON.parse(chunkStr) as GeminiStreamChunk

                // Check if chunk has valid structure
                if (!chunk.candidates || !chunk.candidates[0]) {
                  logger?.debug({ chunkStr }, `Invalid chunk structure`)
                  return
                }

                const candidate = chunk.candidates[0]
                const parts: Part[] = candidate.content?.parts || []

                parts
                  .filter((part: Part) => part.text && part.thought === true)
                  .forEach((part: Part) => {
                    if (!hasThinkingContent) {
                      hasThinkingContent = true
                    }
                    const thinkingChunk: PipelineStreamChunk = {
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            content: null,
                            thinking: {
                              content: part.text
                            }
                          },
                          finish_reason: null,
                          index: contentIndex,
                          logprobs: null
                        }
                      ],
                      created: nowSeconds(),
                      id: chunk.responseId || '',
                      model: chunk.modelVersion || '',
                      object: 'chat.completion.chunk',
                      system_fingerprint: 'fp_a49d71b8a1'
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(thinkingChunk)}\n\n`))
                  })

                const signature = parts.find((part: Part) => part.thoughtSignature)?.thoughtSignature
                if (signature && !signatureSent) {
                  if (!hasThinkingContent) {
                    const thinkingChunk: PipelineStreamChunk = {
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            content: null,
                            thinking: {
                              content: '(no content)'
                            }
                          },
                          finish_reason: null,
                          index: contentIndex,
                          logprobs: null
                        }
                      ],
                      created: nowSeconds(),
                      id: chunk.responseId || '',
                      model: chunk.modelVersion || '',
                      object: 'chat.completion.chunk',
                      system_fingerprint: 'fp_a49d71b8a1'
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(thinkingChunk)}\n\n`))
                  }
                  const signatureChunk: PipelineStreamChunk = {
                    choices: [
                      {
                        delta: {
                          role: 'assistant',
                          content: null,
                          thinking: {
                            signature
                          }
                        },
                        finish_reason: null,
                        index: contentIndex,
                        logprobs: null
                      }
                    ],
                    created: nowSeconds(),
                    id: chunk.responseId || '',
                    model: chunk.modelVersion || '',
                    object: 'chat.completion.chunk',
                    system_fingerprint: 'fp_a49d71b8a1'
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(signatureChunk)}\n\n`))
                  signatureSent = true
                  contentIndex++
                  if (pendingContent) {
                    const res: PipelineStreamChunk = {
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            content: pendingContent
                          },
                          finish_reason: null,
                          index: contentIndex,
                          logprobs: null
                        }
                      ],
                      created: nowSeconds(),
                      id: chunk.responseId || '',
                      model: chunk.modelVersion || '',
                      object: 'chat.completion.chunk',
                      system_fingerprint: 'fp_a49d71b8a1'
                    }

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(res)}\n\n`))

                    pendingContent = ''
                    if (!contentSent) {
                      contentSent = true
                    }
                  }
                }

                const tool_calls: PipelineToolCall[] = parts
                  .filter((part: Part) => part.functionCall)
                  .map((part: Part) => ({
                    id: part.functionCall?.id || `ccr_tool_${Math.random().toString(36).substring(2, 15)}`,
                    type: 'function' as const,
                    function: {
                      name: part.functionCall?.name,
                      arguments: JSON.stringify(part.functionCall?.args || {})
                    }
                  }))

                const textContent = parts
                  .filter((part: Part) => part.text && part.thought !== true)
                  .map((part: Part) => part.text)
                  .join('\n')

                if (!textContent && signatureSent && !contentSent) {
                  const emptyContentChunk: PipelineStreamChunk = {
                    choices: [
                      {
                        delta: {
                          role: 'assistant',
                          content: '(no content)'
                        },
                        index: contentIndex,
                        finish_reason: null,
                        logprobs: null
                      }
                    ],
                    created: nowSeconds(),
                    id: chunk.responseId || '',
                    model: chunk.modelVersion || '',
                    object: 'chat.completion.chunk',
                    system_fingerprint: 'fp_a49d71b8a1'
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(emptyContentChunk)}\n\n`))

                  if (!contentSent) {
                    contentSent = true
                  }
                }

                if (hasThinkingContent && textContent && !signatureSent) {
                  if (chunk.modelVersion.includes('3')) {
                    pendingContent += textContent
                    return
                  } else {
                    const signatureChunk: PipelineStreamChunk = {
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            content: null,
                            thinking: {
                              signature: `ccr_${+new Date()}`
                            }
                          },
                          finish_reason: null,
                          index: contentIndex,
                          logprobs: null
                        }
                      ],
                      created: nowSeconds(),
                      id: chunk.responseId || '',
                      model: chunk.modelVersion || '',
                      object: 'chat.completion.chunk',
                      system_fingerprint: 'fp_a49d71b8a1'
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(signatureChunk)}\n\n`))
                    signatureSent = true
                  }
                }

                if (textContent) {
                  if (!pendingContent) contentIndex++
                  const res: PipelineStreamChunk = {
                    choices: [
                      {
                        delta: {
                          role: 'assistant',
                          content: textContent
                        },
                        finish_reason: candidate.finishReason?.toLowerCase() || null,
                        index: contentIndex,
                        logprobs: null
                      }
                    ],
                    created: nowSeconds(),
                    id: chunk.responseId || '',
                    model: chunk.modelVersion || '',
                    object: 'chat.completion.chunk',
                    system_fingerprint: 'fp_a49d71b8a1',
                    usage: {
                      completion_tokens: chunk.usageMetadata?.candidatesTokenCount || 0,
                      prompt_tokens: chunk.usageMetadata?.promptTokenCount || 0,
                      prompt_tokens_details: {
                        cached_tokens: chunk.usageMetadata?.cachedContentTokenCount || 0
                      },
                      total_tokens: chunk.usageMetadata?.totalTokenCount || 0,
                      output_tokens_details: {
                        reasoning_tokens: chunk.usageMetadata?.thoughtsTokenCount || 0
                      }
                    }
                  }

                  const annotations = buildAnnotations(candidate)
                  if (annotations) {
                    res.choices[0].delta.annotations = annotations
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(res)}\n\n`))

                  if (!contentSent && textContent) {
                    contentSent = true
                  }
                }

                if (tool_calls.length > 0) {
                  tool_calls.forEach((tool) => {
                    contentIndex++
                    toolCallIndex++
                    const res: PipelineStreamChunk = {
                      choices: [
                        {
                          delta: {
                            role: 'assistant',
                            tool_calls: [
                              {
                                ...tool,
                                index: toolCallIndex
                              }
                            ]
                          },
                          finish_reason: candidate.finishReason?.toLowerCase() || null,
                          index: contentIndex,
                          logprobs: null
                        }
                      ],
                      created: nowSeconds(),
                      id: chunk.responseId || '',
                      model: chunk.modelVersion || '',
                      object: 'chat.completion.chunk',
                      system_fingerprint: 'fp_a49d71b8a1',
                      usage: {
                        completion_tokens: chunk.usageMetadata?.candidatesTokenCount || 0,
                        prompt_tokens: chunk.usageMetadata?.promptTokenCount || 0,
                        prompt_tokens_details: {
                          cached_tokens: chunk.usageMetadata?.cachedContentTokenCount || 0
                        },
                        total_tokens: chunk.usageMetadata?.totalTokenCount || 0,
                        output_tokens_details: {
                          reasoning_tokens: chunk.usageMetadata?.thoughtsTokenCount || 0
                        }
                      }
                    }

                    const annotations = buildAnnotations(candidate)
                    if (annotations) {
                      res.choices[0].delta.annotations = annotations
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(res)}\n\n`))
                  })

                  if (!contentSent && textContent) {
                    contentSent = true
                  }
                }
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error)
                logger?.error({ chunkStr, error: message }, `Error parsing ${providerName} stream chunk`)
              }
            }
          }
        }

        const reader = response.body!.getReader()
        let buffer = ''
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              if (buffer) {
                await processLine(buffer, controller)
              }
              break
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')

            buffer = lines.pop() || ''

            for (const line of lines) {
              await processLine(line, controller)
            }
          }
        } catch (error) {
          controller.error(error)
        } finally {
          controller.close()
        }
      }
    })

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }

  // Neither JSON nor stream: return upstream verbatim (mirrors legacy
  // implicit-undefined return).
  return response
}
