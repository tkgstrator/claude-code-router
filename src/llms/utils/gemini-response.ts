/**
 * Gemini → OpenAI-shaped response conversion.
 *
 * Converts both blocking JSON responses and SSE streams emitted by the
 * Gemini `generateContent` / `streamGenerateContent` endpoints into the
 * pipeline's internal OpenAI-flavoured shape (chat completion + chunk).
 */

import type { Logger } from 'pino'
import dayjs from '@/lib/dayjs'
import {
  type Annotation,
  type GeminiCandidate,
  type GeminiResponse,
  type GeminiResponsePart,
  GeminiResponseSchema,
  type GeminiStreamChunk,
  GeminiStreamChunkSchema,
  type PipelineChunkChoice,
  type PipelineChunkUsage,
  type PipelineDelta,
  type PipelineStreamChunk,
  type PipelineToolCall,
  type PipelineToolCallDelta
} from '@/schemas'

// (PipelineToolCall, PipelineDelta, PipelineChunkChoice, PipelineChunkUsage,
//  PipelineStreamChunk, PipelineToolCallDelta now live in @/schemas/llm-gemini.dto)

const SYSTEM_FINGERPRINT = 'fp_a49d71b8a1'

const genRandomToolId = (prefix: 'tool' | 'ccr_tool' = 'tool'): string =>
  `${prefix}_${Math.random().toString(36).substring(2, 15)}`

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/** A zero-filled usage block used when the upstream omitted `usageMetadata`. */
const EMPTY_USAGE: PipelineChunkUsage = {
  completion_tokens: 0,
  prompt_tokens: 0,
  prompt_tokens_details: { cached_tokens: 0 },
  total_tokens: 0,
  output_tokens_details: { reasoning_tokens: 0 }
}

/**
 * Build the OpenAI-shaped `usage` block from Gemini's `usageMetadata`.
 * Returns the zero-filled `EMPTY_USAGE` when the upstream omitted the
 * `usageMetadata` envelope entirely — the inner field defaults are
 * handled by the Zod schema itself.
 */
function toUsage(meta: GeminiResponse['usageMetadata']): PipelineChunkUsage {
  if (!meta) {
    return EMPTY_USAGE
  }
  return {
    completion_tokens: meta.candidatesTokenCount,
    prompt_tokens: meta.promptTokenCount,
    prompt_tokens_details: { cached_tokens: meta.cachedContentTokenCount },
    total_tokens: meta.totalTokenCount,
    output_tokens_details: { reasoning_tokens: meta.thoughtsTokenCount }
  }
}

/** Empty `segment` block used when no grounding support matches the chunk. */
const EMPTY_SEGMENT = { text: '', startIndex: 0, endIndex: 0 } as const

/**
 * Build the annotations slice — Gemini emits one `groundingChunk` per
 * citation plus optional `groundingSupports` keyed by index.
 */
function buildAnnotations(candidate: GeminiCandidate): Annotation[] | undefined {
  const grounding = candidate.groundingMetadata
  if (!grounding || grounding.groundingChunks.length === 0) {
    return undefined
  }
  return grounding.groundingChunks.map<Annotation>((groundingChunk, index) => {
    const support = grounding.groundingSupports.find((item) => item.groundingChunkIndices.includes(index))
    const segment = support ? support.segment : EMPTY_SEGMENT
    return {
      type: 'url_citation',
      url_citation: {
        url: groundingChunk.web.uri,
        title: groundingChunk.web.title,
        content: segment.text,
        start_index: segment.startIndex,
        end_index: segment.endIndex
      }
    }
  })
}

// ─── Blocking JSON branch ──────────────────────────────────────────────

/**
 * Split a Gemini response's parts into the thinking text bucket and the
 * remaining (non-thought) parts.
 */
function splitThinking(parts: GeminiResponsePart[]): {
  thinkingContent: string
  nonThinkingParts: GeminiResponsePart[]
} {
  let thinkingContent = ''
  const nonThinkingParts: GeminiResponsePart[] = []
  for (const part of parts) {
    if (part.text && part.thought === true) {
      thinkingContent += part.text
    } else {
      nonThinkingParts.push(part)
    }
  }
  return { thinkingContent, nonThinkingParts }
}

type FunctionCallPart = GeminiResponsePart & {
  functionCall: NonNullable<GeminiResponsePart['functionCall']>
}

const hasFunctionCall = (part: GeminiResponsePart): part is FunctionCallPart => Boolean(part.functionCall)

/** Build the pipeline tool-call list from non-thinking parts. */
function toPipelineToolCalls(parts: GeminiResponsePart[], idPrefix: 'tool' | 'ccr_tool' = 'tool'): PipelineToolCall[] {
  return parts.filter(hasFunctionCall).map(
    (part): PipelineToolCall => ({
      id: part.functionCall.id || genRandomToolId(idPrefix),
      type: 'function' as const,
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args)
      }
    })
  )
}

/**
 * Build the assistant `message` shape for the blocking JSON response.
 * Returns an object so the caller can spread it into the choice.
 */
function buildAssistantMessage(parts: GeminiResponsePart[]): {
  content: string
  role: 'assistant'
  tool_calls?: PipelineToolCall[]
  thinking?: { content: string; signature: string }
} {
  const { thinkingContent, nonThinkingParts } = splitThinking(parts)
  const thinkingSignature = parts.find((part) => part.thoughtSignature)?.thoughtSignature
  const tool_calls = toPipelineToolCalls(nonThinkingParts)
  const textContent = nonThinkingParts
    .filter((part) => typeof part.text === 'string' && part.text.length > 0)
    .map((part) => part.text)
    .join('\n')

  const message: ReturnType<typeof buildAssistantMessage> = {
    content: textContent,
    role: 'assistant',
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined
  }
  if (thinkingSignature) {
    message.thinking = {
      content: thinkingContent || '(no content)',
      signature: thinkingSignature
    }
  }
  return message
}

/** Extract the parts[] from a candidate, falling back to []. */
function partsOf(candidate: GeminiCandidate | undefined): GeminiResponsePart[] {
  if (!candidate?.content) {
    return []
  }
  return candidate.content.parts
}

/** Convert Gemini's `finishReason` into the lower-cased pipeline form. */
function lowercaseFinishReason(candidate: GeminiCandidate): string | null {
  const raw = candidate.finishReason
  if (typeof raw !== 'string') {
    return null
  }
  return raw.toLowerCase()
}

/** Build the full OpenAI-shaped response body for the blocking JSON branch. */
function buildBlockingResponseBody(jsonResponse: GeminiResponse): unknown {
  const firstCandidate = jsonResponse.candidates[0]
  const parts = partsOf(firstCandidate)
  const rawFinishReason = firstCandidate?.finishReason
  const finishReason = typeof rawFinishReason === 'string' ? rawFinishReason.toLowerCase() : null
  return {
    id: jsonResponse.responseId,
    choices: [
      {
        finish_reason: finishReason,
        index: 0,
        message: buildAssistantMessage(parts)
      }
    ],
    created: nowSeconds(),
    model: jsonResponse.modelVersion,
    object: 'chat.completion',
    usage: toUsage(jsonResponse.usageMetadata)
  }
}

async function transformBlockingResponse(response: Response, providerName: string, logger?: Logger): Promise<Response> {
  const rawJson: unknown = await response.json()
  const parsed = GeminiResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid Gemini JSON response: ${JSON.stringify(parsed.error.issues)}`)
  }
  logger?.debug({ response: parsed.data }, `${providerName} response:`)
  const body = buildBlockingResponseBody(parsed.data)
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

// ─── Streaming SSE branch ──────────────────────────────────────────────

/**
 * Mutable per-stream conversion state. Pulled out of `start()` so the
 * helper functions can read/write it without ballooning closure args.
 */
type StreamState = {
  signatureSent: boolean
  contentSent: boolean
  hasThinkingContent: boolean
  pendingContent: string
  contentIndex: number
  toolCallIndex: number
}

const createStreamState = (): StreamState => ({
  signatureSent: false,
  contentSent: false,
  hasThinkingContent: false,
  pendingContent: '',
  contentIndex: 0,
  toolCallIndex: -1
})

/**
 * Build a baseline streaming chunk shell. Callers populate `delta` and
 * (optionally) `usage` / `finish_reason` for their specific event type.
 */
function newChunkShell(
  chunk: GeminiStreamChunk,
  index: number,
  delta: PipelineDelta,
  finishReason: string | null
): PipelineStreamChunk {
  return {
    choices: [
      {
        delta,
        finish_reason: finishReason,
        index,
        logprobs: null
      }
    ],
    created: nowSeconds(),
    id: chunk.responseId,
    model: chunk.modelVersion,
    object: 'chat.completion.chunk',
    system_fingerprint: SYSTEM_FINGERPRINT
  }
}

const enqueueChunk = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  chunk: PipelineStreamChunk
): void => {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
}

/** Emit the thinking-text deltas (one chunk per Gemini "thought" part). */
function emitThinkingTextDeltas(
  parts: GeminiResponsePart[],
  chunk: GeminiStreamChunk,
  state: StreamState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const thoughtParts = parts.filter((part) => part.text && part.thought === true)
  for (const part of thoughtParts) {
    state.hasThinkingContent = true
    enqueueChunk(
      controller,
      encoder,
      newChunkShell(
        chunk,
        state.contentIndex,
        { role: 'assistant', content: null, thinking: { content: part.text } },
        null
      )
    )
  }
}

/**
 * Emit the signature chunk (and, when no prior thinking content was
 * streamed, a synthetic `(no content)` thinking chunk to keep clients
 * happy). Side-effects `state.signatureSent`, `state.contentIndex`, and
 * flushes any `pendingContent` accumulated before the signature.
 */
function emitSignatureChunk(
  signature: string,
  chunk: GeminiStreamChunk,
  state: StreamState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (!state.hasThinkingContent) {
    enqueueChunk(
      controller,
      encoder,
      newChunkShell(
        chunk,
        state.contentIndex,
        { role: 'assistant', content: null, thinking: { content: '(no content)' } },
        null
      )
    )
  }
  enqueueChunk(
    controller,
    encoder,
    newChunkShell(chunk, state.contentIndex, { role: 'assistant', content: null, thinking: { signature } }, null)
  )
  state.signatureSent = true
  state.contentIndex++
  if (state.pendingContent) {
    enqueueChunk(
      controller,
      encoder,
      newChunkShell(chunk, state.contentIndex, { role: 'assistant', content: state.pendingContent }, null)
    )
    state.pendingContent = ''
    state.contentSent = true
  }
}

/** Emit a `(no content)` chunk when the model produced only a signature. */
function emitEmptyContentChunk(
  chunk: GeminiStreamChunk,
  state: StreamState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  enqueueChunk(
    controller,
    encoder,
    newChunkShell(chunk, state.contentIndex, { role: 'assistant', content: '(no content)' }, null)
  )
  state.contentSent = true
}

/**
 * Emit a synthetic signature chunk for non-`gemini-3*` models when
 * thinking content was produced but no real signature arrived from
 * upstream. The signature is a wall-clock millisecond stamp prefixed
 * with `ccr_` so downstream clients can still pair text with reasoning.
 */
function emitSyntheticSignature(
  chunk: GeminiStreamChunk,
  state: StreamState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  enqueueChunk(
    controller,
    encoder,
    newChunkShell(
      chunk,
      state.contentIndex,
      { role: 'assistant', content: null, thinking: { signature: `ccr_${dayjs().valueOf()}` } },
      null
    )
  )
  state.signatureSent = true
}

/** Emit the main text-content chunk (with usage + optional annotations). */
function emitTextContentChunk(
  textContent: string,
  candidate: GeminiCandidate,
  chunk: GeminiStreamChunk,
  state: StreamState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (!state.pendingContent) {
    state.contentIndex++
  }
  const out: PipelineStreamChunk = {
    ...newChunkShell(
      chunk,
      state.contentIndex,
      { role: 'assistant', content: textContent },
      lowercaseFinishReason(candidate)
    ),
    usage: toUsage(chunk.usageMetadata)
  }
  const annotations = buildAnnotations(candidate)
  if (annotations) {
    out.choices[0].delta.annotations = annotations
  }
  enqueueChunk(controller, encoder, out)
  state.contentSent = true
}

/** Emit one chunk per tool call (preserving the per-stream `toolCallIndex`). */
function emitToolCallChunks(
  tool_calls: PipelineToolCall[],
  candidate: GeminiCandidate,
  chunk: GeminiStreamChunk,
  state: StreamState,
  textContent: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  for (const tool of tool_calls) {
    state.contentIndex++
    state.toolCallIndex++
    const out: PipelineStreamChunk = {
      ...newChunkShell(
        chunk,
        state.contentIndex,
        {
          role: 'assistant',
          tool_calls: [{ ...tool, index: state.toolCallIndex }]
        },
        lowercaseFinishReason(candidate)
      ),
      usage: toUsage(chunk.usageMetadata)
    }
    const annotations = buildAnnotations(candidate)
    if (annotations) {
      out.choices[0].delta.annotations = annotations
    }
    enqueueChunk(controller, encoder, out)
  }
  if (textContent) {
    state.contentSent = true
  }
}

/**
 * Process a single parsed Gemini stream chunk and emit zero or more
 * pipeline-shaped chunks into `controller`.
 */
function processChunk(
  chunk: GeminiStreamChunk,
  state: StreamState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const candidate = chunk.candidates[0]
  if (!candidate) {
    return
  }
  const parts: GeminiResponsePart[] = partsOf(candidate)

  emitThinkingTextDeltas(parts, chunk, state, controller, encoder)

  const signature = parts.find((part) => part.thoughtSignature)?.thoughtSignature
  if (signature && !state.signatureSent) {
    emitSignatureChunk(signature, chunk, state, controller, encoder)
  }

  const tool_calls = toPipelineToolCalls(parts, 'ccr_tool')
  const textContent = parts
    .filter((part) => typeof part.text === 'string' && part.text.length > 0 && part.thought !== true)
    .map((part) => part.text)
    .join('\n')

  if (!textContent && state.signatureSent && !state.contentSent) {
    emitEmptyContentChunk(chunk, state, controller, encoder)
  }

  if (state.hasThinkingContent && textContent && !state.signatureSent) {
    if (chunk.modelVersion.includes('3')) {
      state.pendingContent += textContent
      return
    }
    emitSyntheticSignature(chunk, state, controller, encoder)
  }

  if (textContent) {
    emitTextContentChunk(textContent, candidate, chunk, state, controller, encoder)
  }

  if (tool_calls.length > 0) {
    emitToolCallChunks(tool_calls, candidate, chunk, state, textContent, controller, encoder)
  }
}

/** Parse one SSE `data: …` line into a typed chunk, or return null. */
function parseSseLine(line: string, providerName: string, logger?: Logger): GeminiStreamChunk | null {
  if (!line.startsWith('data: ')) {
    return null
  }
  const chunkStr = line.slice(6).trim()
  if (!chunkStr) {
    return null
  }
  logger?.debug({ chunkStr }, `${providerName} chunk:`)
  try {
    const raw: unknown = JSON.parse(chunkStr)
    const parsed = GeminiStreamChunkSchema.safeParse(raw)
    if (!parsed.success) {
      logger?.debug({ chunkStr }, `Invalid chunk structure`)
      return null
    }
    return parsed.data
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger?.error({ chunkStr, error: message }, `Error parsing ${providerName} stream chunk`)
    return null
  }
}

/**
 * Async generator that yields complete newline-delimited lines from a
 * `Response.body` byte stream. Pulled out so the producer can avoid a
 * `while (true) { reader.read() }` loop in favour of `for await`.
 */
/**
 * Adapter that exposes a `ReadableStream<Uint8Array>` as an `AsyncIterable`.
 * Node 18 already implements the async-iterator protocol on its native
 * `ReadableStream`, but the TypeScript DOM lib definitions do not advertise
 * it — wrapping the reader manually keeps the conversion explicit and
 * lets us use `for await` without a type assertion.
 */
function asAsyncIterable(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const reader = body.getReader()
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          const { done, value } = await reader.read()
          if (done || value === undefined) {
            return { done: true, value: undefined }
          }
          return { done: false, value }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          reader.releaseLock()
          return { done: true, value: undefined }
        }
      }
    }
  }
}

async function* iterateLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const value of asAsyncIterable(body)) {
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    const remainder = lines.pop()
    buffer = typeof remainder === 'string' ? remainder : ''
    for (const line of lines) {
      yield line
    }
  }
  buffer += decoder.decode()
  if (buffer.length > 0) {
    yield buffer
  }
}

/** Stream branch — replays Gemini's SSE as the pipeline-shaped SSE. */
function transformStreamingResponse(response: Response, providerName: string, logger?: Logger): Response {
  if (!response.body) {
    return response
  }
  const body = response.body
  const encoder = new TextEncoder()
  const state = createStreamState()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const line of iterateLines(body)) {
          const chunk = parseSseLine(line, providerName, logger)
          if (chunk) {
            processChunk(chunk, state, controller, encoder)
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
  const contentType = response.headers.get('Content-Type')
  if (contentType?.includes('application/json')) {
    return transformBlockingResponse(response, providerName, logger)
  }
  if (contentType?.includes('stream')) {
    return transformStreamingResponse(response, providerName, logger)
  }
  // Neither JSON nor stream: return upstream verbatim (mirrors legacy
  // implicit-undefined return).
  return response
}
