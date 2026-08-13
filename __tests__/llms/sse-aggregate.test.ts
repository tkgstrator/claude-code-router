/**
 * Unit tests for the SSE→JSON aggregators. These fire in the
 * `formatResponse` branch that trips when the client asked for
 * stream=false but the upstream forced SSE (codex-oauth is the
 * canonical case). One aggregator per inbound wire shape.
 */

import { describe, expect, test } from 'bun:test'
import {
  aggregateOpenAiChatSseToJson,
  aggregateOpenAiResponsesSseToJson
} from '../../src/llms/utils/sse-aggregate'

const sseResponse = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })

const buildChatChunk = (payload: Record<string, unknown>): string =>
  `data: ${JSON.stringify(payload)}\n\n`

describe('aggregateOpenAiChatSseToJson', () => {
  test('folds text-delta chunks into a single choice with joined content', async () => {
    const body =
      buildChatChunk({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1_700_000_000,
        model: 'gpt-4.1-mini',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }]
      }) +
      buildChatChunk({
        id: 'chatcmpl-1',
        choices: [{ index: 0, delta: { content: 'lo' } }]
      }) +
      buildChatChunk({
        id: 'chatcmpl-1',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      }) +
      'data: [DONE]\n\n'
    const result = await aggregateOpenAiChatSseToJson(sseResponse(body))
    expect(result.id).toBe('chatcmpl-1')
    expect(result.object).toBe('chat.completion')
    expect(result.model).toBe('gpt-4.1-mini')
    const choices = result.choices as Array<Record<string, unknown>>
    expect(choices).toHaveLength(1)
    expect(choices[0].finish_reason).toBe('stop')
    const message = choices[0].message as Record<string, unknown>
    expect(message.role).toBe('assistant')
    expect(message.content).toBe('Hello')
  })

  test('joins tool_call arguments across per-index chunks', async () => {
    const body =
      buildChatChunk({
        id: 'chatcmpl-tc',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'search', arguments: '{"q":' }
                }
              ]
            }
          }
        ]
      }) +
      buildChatChunk({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"tokyo"}' } }] }
          }
        ]
      }) +
      buildChatChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
      })
    const result = await aggregateOpenAiChatSseToJson(sseResponse(body))
    const message = (result.choices as Array<Record<string, unknown>>)[0].message as Record<string, unknown>
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].id).toBe('call_1')
    expect(toolCalls[0].type).toBe('function')
    expect((toolCalls[0].function as Record<string, unknown>).name).toBe('search')
    expect((toolCalls[0].function as Record<string, unknown>).arguments).toBe('{"q":"tokyo"}')
  })

  test('preserves usage when the terminal chunk carries it', async () => {
    const body =
      buildChatChunk({
        id: 'chatcmpl-usage',
        model: 'gpt-4.1-mini',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
      })
    const result = await aggregateOpenAiChatSseToJson(sseResponse(body))
    expect(result.usage).toEqual({ prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 })
  })
})

describe('aggregateOpenAiResponsesSseToJson', () => {
  test('returns the response payload from response.completed verbatim', async () => {
    const completed = {
      type: 'response.completed',
      response: {
        id: 'resp_ok',
        object: 'response',
        status: 'completed',
        model: 'gpt-5.6-luna',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'pong', annotations: [] }]
          }
        ],
        usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 }
      }
    }
    const body =
      `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_ok', object: 'response' } })}\n\n` +
      `data: ${JSON.stringify(completed)}\n\n`
    const result = await aggregateOpenAiResponsesSseToJson(sseResponse(body))
    expect(result).toEqual(completed.response)
  })

  test('falls back to text accumulator when response.completed never lands', async () => {
    const body =
      `data: ${JSON.stringify({
        type: 'response.created',
        response: { id: 'resp_cut', object: 'response', model: 'gpt-5.6-luna', output: [] }
      })}\n\n` +
      `data: ${JSON.stringify({
        type: 'response.output_text.delta',
        output_index: 0,
        delta: 'part-1 '
      })}\n\n` +
      `data: ${JSON.stringify({
        type: 'response.output_text.delta',
        output_index: 0,
        delta: 'part-2'
      })}\n\n`
    const result = await aggregateOpenAiResponsesSseToJson(sseResponse(body))
    expect(result.status).toBe('incomplete')
    const output = result.output as Array<Record<string, unknown>>
    expect(output).toHaveLength(1)
    const content = output[0].content as Array<Record<string, unknown>>
    expect(content[0].text).toBe('part-1 part-2')
  })

  test('empty stream returns a skeleton envelope rather than throwing', async () => {
    const result = await aggregateOpenAiResponsesSseToJson(sseResponse(''))
    expect(result.object).toBe('response')
    expect(result.status).toBe('incomplete')
    expect(result.output).toEqual([])
  })
})
