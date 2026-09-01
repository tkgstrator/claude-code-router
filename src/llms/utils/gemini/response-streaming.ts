/**
 * Gemini → OpenAI-shaped response conversion: streaming SSE branch.
 *
 * Converts the Gemini `streamGenerateContent` SSE stream into the
 * pipeline's internal OpenAI-flavoured chunk shape. See
 * `response-blocking.ts` for the non-streaming counterpart.
 */

import type { Logger } from 'pino'
import dayjs from '@/lib/dayjs'
import {
  type GeminiCandidate,
  type GeminiResponsePart,
  type GeminiStreamChunk,
  GeminiStreamChunkSchema,
  type PipelineDelta,
  type PipelineStreamChunk,
  type PipelineToolCall
} from '@/schemas/wire'
import { cloneResponse } from '../response-clone'
import {
  buildAnnotations,
  lowercaseFinishReason,
  nowSeconds,
  partsOf,
  toPipelineToolCalls,
  toUsage
} from './response-shared'
import { iterateLines } from './sse-lines'

const SYSTEM_FINGERPRINT = 'fp_a49d71b8a1'

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
 * with `rialto_` so downstream clients can still pair text with reasoning.
 * The Anthropic transformer strips blocks carrying either this prefix or
 * the pre-rename `ccr_` one — Anthropic cannot validate a signature it
 * did not issue.
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
      { role: 'assistant', content: null, thinking: { signature: `rialto_${dayjs().valueOf()}` } },
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

  const tool_calls = toPipelineToolCalls(parts, 'rialto_tool')
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

/** Stream branch — replays Gemini's SSE as the pipeline-shaped SSE. */
export function transformStreamingResponse(response: Response, providerName: string, logger?: Logger): Response {
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

  return cloneResponse(response, stream)
}
