/**
 * OpenAI-shaped → Gemini response conversion.
 *
 * The inverse of `gemini-response.ts`. That file exists because a Gemini
 * PROVIDER answers in Gemini's wire format and the pipeline's internal
 * shape is OpenAI's; this one exists because a Gemini CLIENT expects
 * Gemini's wire format back, and the pipeline hands the endpoint
 * transformer the internal shape no matter which provider served the
 * request.
 *
 * Without it the gemini surface only works when it happens to resolve to
 * a Gemini provider — the pipeline takes its bypass path there and no
 * conversion runs at all. Point the surface at any other provider (which
 * is exactly what turning its routing mode to `routed` invites) and the
 * client would get a 200 carrying an OpenAI `chat.completion` body, which
 * the Google SDKs parse into an empty response rather than an error.
 * A wrong answer that looks like a right one is the worst outcome
 * available, so the conversion is here.
 */

import type { Logger } from 'pino'
import { iterateLines } from './gemini/sse-lines'
import { isObject } from './guards'

// ─── small readers ─────────────────────────────────────────────────────
//
// Everything arriving here is `unknown`: the pipeline's in-flight body
// has passed through an arbitrary chain of transformers, so nothing about
// its shape can be assumed. These readers keep that narrowing in one
// place instead of repeating a guard at every field.

const readRecord = (source: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isObject(source)) return undefined
  const value = source[key]
  return isObject(value) ? value : undefined
}

const readString = (source: unknown, key: string): string | undefined => {
  if (!isObject(source)) return undefined
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const readNumber = (source: unknown, key: string, fallback: number): number => {
  if (!isObject(source)) return fallback
  const value = source[key]
  return typeof value === 'number' ? value : fallback
}

// ─── finish reason ─────────────────────────────────────────────────────

/**
 * OpenAI's `finish_reason` → Gemini's `finishReason`.
 *
 * `tool_calls` has no Gemini counterpart: Gemini says a turn ended with
 * a tool call by putting a `functionCall` part in the content and
 * finishing STOP. Mapping it to anything else would tell the client the
 * turn failed.
 */
function toGeminiFinishReason(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  if (raw === 'stop' || raw === 'tool_calls' || raw === 'function_call') return 'STOP'
  if (raw === 'length') return 'MAX_TOKENS'
  if (raw === 'content_filter') return 'SAFETY'
  return raw.toUpperCase()
}

// ─── usage ─────────────────────────────────────────────────────────────

/**
 * OpenAI `usage` → Gemini `usageMetadata`.
 *
 * The two optional counts are emitted only when non-zero, which is what
 * Google itself does — a client that renders "cached: 0" for every turn
 * would be reporting a fact the upstream never stated.
 */
function toUsageMetadata(usage: unknown): Record<string, unknown> | undefined {
  if (!isObject(usage)) return undefined
  const meta: Record<string, unknown> = {
    promptTokenCount: readNumber(usage, 'prompt_tokens', 0),
    candidatesTokenCount: readNumber(usage, 'completion_tokens', 0),
    totalTokenCount: readNumber(usage, 'total_tokens', 0)
  }
  const cached = readNumber(readRecord(usage, 'prompt_tokens_details'), 'cached_tokens', 0)
  if (cached > 0) meta.cachedContentTokenCount = cached
  const reasoning = readNumber(readRecord(usage, 'output_tokens_details'), 'reasoning_tokens', 0)
  if (reasoning > 0) meta.thoughtsTokenCount = reasoning
  return meta
}

// ─── parts ─────────────────────────────────────────────────────────────

interface ToolCallAcc {
  id?: string
  name?: string
  args: string
}

/**
 * One tool call → one `functionCall` part.
 *
 * OpenAI carries arguments as a JSON string; Gemini carries them as an
 * object. An unparseable string means the upstream sent something we
 * cannot represent — the call is still emitted (dropping it would make
 * the model look like it said nothing) with empty args and a warning,
 * because a tool invocation the client can see and reject beats one that
 * silently vanishes.
 */
function toFunctionCallPart(call: ToolCallAcc, logger?: Logger): Record<string, unknown> {
  const parsed = parseArguments(call.args, call.name, logger)
  const functionCall: Record<string, unknown> = { name: call.name !== undefined ? call.name : '', args: parsed }
  if (call.id !== undefined && call.id.length > 0) functionCall.id = call.id
  return { functionCall }
}

function parseArguments(raw: string, name: string | undefined, logger?: Logger): Record<string, unknown> {
  if (raw.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isObject(parsed)) return parsed
  } catch {
    // Fall through to the warning below — a malformed fragment is
    // reported once rather than thrown.
  }
  logger?.warn({ tool: name }, 'gemini inbound: tool-call arguments were not a JSON object; sending empty args')
  return {}
}

/**
 * Assemble the `parts` array for one assistant turn.
 *
 * Order is reasoning, then answer text, then tool calls — the order
 * Gemini itself emits, and the order a client renders in. Empty text is
 * omitted rather than sent as `{ text: '' }`, which some clients render
 * as a blank model turn.
 */
function buildParts(
  input: { thinking?: string; text?: string; toolCalls: ToolCallAcc[] },
  logger?: Logger
): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = []
  if (input.thinking !== undefined && input.thinking.length > 0) {
    parts.push({ text: input.thinking, thought: true })
  }
  if (input.text !== undefined && input.text.length > 0) parts.push({ text: input.text })
  for (const call of input.toolCalls) parts.push(toFunctionCallPart(call, logger))
  return parts
}

function readToolCalls(source: unknown): ToolCallAcc[] {
  if (!Array.isArray(source)) return []
  const out: ToolCallAcc[] = []
  for (const raw of source) {
    if (!isObject(raw)) continue
    const fn = readRecord(raw, 'function')
    const args = fn === undefined ? undefined : fn.arguments
    out.push({
      id: readString(raw, 'id'),
      name: fn === undefined ? undefined : readString(fn, 'name'),
      args: typeof args === 'string' ? args : ''
    })
  }
  return out
}

// ─── blocking ──────────────────────────────────────────────────────────

/**
 * A whole `chat.completion` → a whole `GenerateContentResponse`.
 *
 * Every choice becomes a candidate, keyed on the index the upstream
 * gave it, so an `n > 1` request is not silently collapsed to one.
 */
export function convertChatCompletionToGemini(payload: unknown, logger?: Logger): Record<string, unknown> {
  const source = isObject(payload) ? payload : {}
  const rawChoices = Array.isArray(source.choices) ? source.choices : []
  const candidates = rawChoices.map((raw, position) => toCandidate(raw, position, logger))

  const envelope: Record<string, unknown> = { candidates }
  const usageMetadata = toUsageMetadata(source.usage)
  if (usageMetadata !== undefined) envelope.usageMetadata = usageMetadata
  const model = readString(source, 'model')
  if (model !== undefined) envelope.modelVersion = model
  const id = readString(source, 'id')
  if (id !== undefined) envelope.responseId = id
  return envelope
}

function toCandidate(raw: unknown, position: number, logger?: Logger): Record<string, unknown> {
  const choice = isObject(raw) ? raw : {}
  const message = readRecord(choice, 'message')
  const parts = buildParts(
    {
      thinking: readString(readRecord(message, 'thinking'), 'content'),
      text: typeof message?.content === 'string' ? message.content : undefined,
      toolCalls: readToolCalls(message?.tool_calls)
    },
    logger
  )
  const candidate: Record<string, unknown> = {
    content: { role: 'model', parts },
    index: readNumber(choice, 'index', position)
  }
  const finishReason = toGeminiFinishReason(choice.finish_reason)
  if (finishReason !== undefined) candidate.finishReason = finishReason
  return candidate
}

// ─── streaming ─────────────────────────────────────────────────────────

/**
 * An OpenAI `chat.completion.chunk` SSE stream → a Gemini SSE stream.
 *
 * Text and reasoning deltas map one-to-one, so the client sees the same
 * cadence the upstream produced. Tool calls cannot: OpenAI streams the
 * arguments as a series of string fragments and Gemini has no partial
 * `functionCall`, so fragments are accumulated per tool index and the
 * complete calls are emitted on the chunk that carries `finish_reason`.
 *
 * A chunk that would carry nothing (no parts, no finish reason, no
 * usage) is dropped rather than sent as an empty candidate — an OpenAI
 * stream opens with a role-only delta, and forwarding it would show as
 * an empty model turn.
 */
export function convertChatStreamToGeminiSse(
  body: ReadableStream<Uint8Array>,
  logger?: Logger
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const state: StreamState = { toolCalls: new Map(), model: undefined, id: undefined }
      try {
        for await (const line of iterateLines(body)) {
          const out = geminiChunkFor(line, state, logger)
          if (out !== undefined) controller.enqueue(encoder.encode(`data: ${JSON.stringify(out)}\n\n`))
        }
      } catch (error) {
        logger?.warn({ err: error }, 'gemini inbound: upstream stream ended abnormally')
      }
      controller.close()
    },
    cancel(reason) {
      logger?.debug({ reason: String(reason) }, 'gemini inbound: client cancelled the stream')
    }
  })
}

interface StreamState {
  /** Tool-call fragments, keyed by the index the stream reuses for them. */
  toolCalls: Map<number, ToolCallAcc>
  /** Carried across chunks: only the first chunk states them. */
  model?: string
  id?: string
}

/** One SSE line → the Gemini chunk it produces, or nothing to emit. */
function geminiChunkFor(line: string, state: StreamState, logger?: Logger): Record<string, unknown> | undefined {
  const chunk = parseSseChunk(line)
  if (chunk === undefined) return undefined
  if (state.model === undefined) state.model = readString(chunk, 'model')
  if (state.id === undefined) state.id = readString(chunk, 'id')
  return foldChunk(chunk, state, logger)
}

/** `data: {...}` → the parsed object. Comments, keep-alives and `[DONE]`
 *  yield nothing, as does a malformed payload — a partial stream beats a
 *  500. */
function parseSseChunk(line: string): Record<string, unknown> | undefined {
  if (!line.startsWith('data:')) return undefined
  const payload = line.slice(5).trim()
  if (payload.length === 0 || payload === '[DONE]') return undefined
  try {
    const parsed: unknown = JSON.parse(payload)
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function foldChunk(
  chunk: Record<string, unknown>,
  state: StreamState,
  logger?: Logger
): Record<string, unknown> | undefined {
  const rawChoice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
  const choice = isObject(rawChoice) ? rawChoice : {}
  const delta = readRecord(choice, 'delta')

  accumulateToolCallDeltas(delta?.tool_calls, state.toolCalls)

  const finishReason = toGeminiFinishReason(choice.finish_reason)
  const parts = buildParts(
    {
      thinking: readString(readRecord(delta, 'thinking'), 'content'),
      text: typeof delta?.content === 'string' ? delta.content : undefined,
      // Tool calls are only complete once the turn finishes.
      toolCalls: finishReason !== undefined ? [...state.toolCalls.values()] : []
    },
    logger
  )
  const usageMetadata = toUsageMetadata(chunk.usage)
  if (parts.length === 0 && finishReason === undefined && usageMetadata === undefined) return undefined

  const candidate: Record<string, unknown> = {
    content: { role: 'model', parts },
    index: readNumber(choice, 'index', 0)
  }
  if (finishReason !== undefined) candidate.finishReason = finishReason
  const out: Record<string, unknown> = { candidates: [candidate] }
  if (usageMetadata !== undefined) out.usageMetadata = usageMetadata
  if (state.model !== undefined) out.modelVersion = state.model
  if (state.id !== undefined) out.responseId = state.id
  return out
}

function accumulateToolCallDeltas(raw: unknown, toolCalls: Map<number, ToolCallAcc>): void {
  if (!Array.isArray(raw)) return
  for (const entry of raw) {
    if (!isObject(entry)) continue
    const index = readNumber(entry, 'index', 0)
    const existing = toolCalls.get(index)
    toolCalls.set(index, mergeToolCallDelta(existing !== undefined ? existing : { args: '' }, entry))
  }
}

/** Fold one tool-call fragment into the call being assembled at its index. */
function mergeToolCallDelta(acc: ToolCallAcc, entry: Record<string, unknown>): ToolCallAcc {
  const id = readString(entry, 'id')
  if (id !== undefined) acc.id = id
  const fn = readRecord(entry, 'function')
  if (fn === undefined) return acc
  const name = readString(fn, 'name')
  if (name !== undefined) acc.name = name
  // Arguments arrive as a series of fragments that must be concatenated
  // in order; each one alone is not valid JSON.
  if (typeof fn.arguments === 'string') acc.args += fn.arguments
  return acc
}
