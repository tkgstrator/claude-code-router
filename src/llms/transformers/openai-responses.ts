/**
 * OpenAI Responses-API endpoint transformer.
 *
 * Owns `/v1/responses`. Reshapes the unified request into the Responses
 * input/instructions/tools shape and converts the Responses-style
 * (streaming or JSON) reply back into the chat-completions shape the
 * rest of the pipeline expects.
 *
 * The conversion pieces live under `./openai-responses/`:
 *   - `request.ts`         unified request -> Responses input[] shaping
 *   - `response-json.ts`   blocking JSON response -> chat.completion
 *   - `response-stream.ts` SSE session (dispatches into `stream-chunks.ts`)
 *   - `stream-chunks.ts`   per-event-type SSE chunk builders
 *   - `helpers.ts`         small stateless helpers shared by the above
 */

import { HTTPException } from 'hono/http-exception'
import type {
  ResponsesAPIPayload,
  ResponsesStreamItem,
  ResponsesUnifiedChatRequest,
  RuntimeProvider,
  TransformerContext,
  TransformerHookResult,
  UnifiedChatRequest
} from '@/schemas'
import { ChatCompletionResponseSchema, ResponsesAPIPayloadSchema } from '@/schemas'
import { aggregateOpenAiChatSseToJson, isSseContentType } from '../utils/sse-aggregate'
import { Transformer } from './base'
import {
  convertChatCompletionToResponses,
  convertResponsesRequestToUnified,
  wrapResponsesEnvelopeAsSse
} from './openai-responses/inbound'
import {
  collectSystemMessages,
  processNonSystemMessage,
  remapToolChoice,
  remapTools,
  rewriteReasoning
} from './openai-responses/request'
import { convertResponseToChat } from './openai-responses/response-json'
import { ResponsesStreamSession } from './openai-responses/response-stream'

export class OpenAIResponsesTransformer extends Transformer {
  readonly name = 'openai-responses'
  readonly endPoint = '/v1/responses'

  // Endpoint-side inbound hook. Runs once per request BEFORE any
  // provider transformer chain — takes the /v1/responses wire body
  // (input/instructions/tools) and returns a UnifiedChatRequest so
  // scenario routing, `messages`-shaped token counting, and every
  // downstream provider transformer see a consistent shape. Round-trips
  // cleanly when the target provider chain ALSO includes openai-responses
  // (e.g. codex-oauth) — the provider chain's transformRequestIn
  // re-converts unified messages back to Responses shape.
  async transformRequestOut(request: unknown, _context: TransformerContext): Promise<UnifiedChatRequest> {
    if (request === null || typeof request !== 'object') return request as UnifiedChatRequest
    return convertResponsesRequestToUnified(request as Record<string, unknown>)
  }

  // Endpoint-side outbound hook. After the provider chain reversed the
  // upstream reply into unified/chat-completion shape, convert back to
  // the Responses `response` envelope the client asked for. SSE input is
  // buffered — real per-token streaming through the Chat→Responses
  // boundary is future work; for now the wire contract is honoured but
  // TTFT is lost.
  async transformResponseIn(response: Response, _context?: TransformerContext): Promise<Response> {
    if (!response.ok) return response
    const contentType = response.headers.get('content-type')
    if (isSseContentType(contentType)) {
      const chatJsonRaw = await aggregateOpenAiChatSseToJson(response)
      const chat = ChatCompletionResponseSchema.safeParse(chatJsonRaw)
      if (!chat.success) return response
      const envelope = convertChatCompletionToResponses(chat.data)
      const sse = wrapResponsesEnvelopeAsSse(envelope)
      const headers = new Headers(response.headers)
      headers.set('content-type', 'text/event-stream')
      return new Response(sse, { status: response.status, statusText: response.statusText, headers })
    }
    const text = await response.text()
    if (text.length === 0) return response
    const parsedJson = JSON.parse(text)
    const chat = ChatCompletionResponseSchema.safeParse(parsedJson)
    if (!chat.success) return response
    const envelope = convertChatCompletionToResponses(chat.data)
    return new Response(JSON.stringify(envelope), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }

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

    // Manual per-model effort override wins over whatever the client
    // sent (typically inherited from Anthropic's `thinking` block).
    const effortOverride = provider?.modelReasoningEfforts?.[responsesReq.model ?? '']
    if (effortOverride) {
      // biome-ignore plugin: seeding the unified reasoning block so rewriteReasoning below picks up the override; the narrower unified type does not admit direct assignment.
      ;(responsesReq as unknown as { reasoning: { effort: string } }).reasoning = { effort: effortOverride }
    }

    rewriteReasoning(responsesReq)

    const input: unknown[] = []
    collectSystemMessages(responsesReq, input)

    for (const message of responsesReq.messages) {
      if (message.role === 'system') continue
      processNonSystemMessage(message, input)
    }

    responsesReq.input = input
    // biome-ignore plugin: the Responses API rejects `messages` — must be removed before sending; the unified schema does not model field removal.
    delete (responsesReq as { messages?: unknown }).messages

    if (Array.isArray(responsesReq.tools)) {
      const remapped = remapTools(responsesReq.tools)
      // biome-ignore plugin: the Responses API uses a flat `type/name/parameters` tool shape (no nested `function`); the unified UnifiedTool shape is reshaped here on the way out.
      ;(responsesReq as unknown as { tools: unknown }).tools = remapped
    }

    if (responsesReq.tool_choice !== undefined) {
      // biome-ignore plugin: same shape mismatch as `tools` — Responses expects `{type,name}` flat while unified nests the function name; the unified type cannot model the flat shape without breaking the Chat-Completions transformer.
      ;(responsesReq as unknown as { tool_choice: unknown }).tool_choice = remapToolChoice(responsesReq.tool_choice)
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
    const jsonResponse: ResponsesAPIPayload = parsed.data

    // Check whether the JSON response is in the responses API format
    if (jsonResponse.object === 'response' && jsonResponse.output) {
      const chatResponse = convertResponseToChat(jsonResponse, this.logger)
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

    const stream = new ReadableStream({
      async start(controller) {
        const session = new ResponsesStreamSession(controller)
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
}

// Silence unused-type lint for the streaming inner item type re-exported
// from schemas — kept for editor IntelliSense on the SSE branch.
export type { ResponsesStreamItem }
