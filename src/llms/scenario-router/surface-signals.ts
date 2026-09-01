/**
 * The routing signals a request carries, read out of whichever wire
 * format it arrived in.
 *
 * The classifier and the rule predicates used to read `req.body`
 * directly, in Anthropic's vocabulary: `thinking.type`,
 * `output_config.effort`, and `tools[].type` matching `web_search*`.
 * That is only the shape `/v1/messages` sends. Phase 2-3 made the
 * routing *mode* switchable per surface, but the lanes behind the mode
 * stayed unreachable for the other three — an openai-chat or gemini
 * caller could be marked `routed` and would still only ever classify as
 * `default`, because none of the signals the other lanes test for exist
 * under those names. The modes were honest; the router behind them was
 * not.
 *
 * Extraction lives per surface for the same reason the rest of the
 * inbound knowledge does (`src/llms/inbound/surfaces.ts`): adding a
 * fifth surface should mean adding one entry here, not hunting for
 * every place a vocabulary leaked into the router.
 *
 * The set is deliberately small. This is what the scenario lanes and the
 * rule predicates actually test — not a general model of a request.
 * Anything the router does not branch on has no business being
 * normalised here.
 */

import { surfaceForPath } from '@/llms/inbound/surfaces'
import { readGeminiSignals } from '@/llms/utils/gemini/router-signals'
import type { TokenizeContentBlock, TokenizeMessage, TokenizeRequest, TokenizeTool } from '@/schemas/domain/tokenizer'
import { isObject } from '../utils/guards'
import { type EffortLevel, isThinkingEnabled, isWebSearchTool, readEffort } from './request-signals'
import type { RouterRequestBody } from './types'

export type RouterSignals = {
  /** What to hand the tokenizer for the size-based `longContext` branch. */
  tokenize: TokenizeRequest
  /** Did the caller opt INTO extended thinking / reasoning? */
  thinking: boolean
  /** How heavy the caller says the work is, when it says at all. */
  effort: EffortLevel | undefined
  /**
   * Identity of each attached tool, in the surface's own vocabulary —
   * Anthropic names tools by `type`, OpenAI by the function name. The
   * `hasTool` rule predicate globs against these, so what an operator
   * types in the Rules screen is whatever their own client sends.
   */
  toolNames: string[]
  /**
   * Did the caller attach that surface's web-search tool? Separate from
   * `toolNames` because every vendor spells it differently, and the
   * `webSearch` lane asks a semantic question rather than a glob.
   */
  webSearch: boolean
}

type SignalReader = (body: RouterRequestBody) => RouterSignals

/** Tool identities as Anthropic names them: the block's `type`. */
const anthropicToolNames = (tools: unknown): string[] => {
  if (!Array.isArray(tools)) return []
  return tools
    .map((tool) => (tool !== null && typeof tool === 'object' ? Reflect.get(tool, 'type') : undefined))
    .filter((t): t is string => typeof t === 'string')
}

const readAnthropicSignals: SignalReader = (body) => ({
  tokenize: {
    messages: Array.isArray(body.messages) ? body.messages : [],
    system: body.system,
    tools: body.tools
  },
  thinking: isThinkingEnabled(body),
  effort: readEffort(body),
  toolNames: anthropicToolNames(body.tools),
  webSearch: Array.isArray(body.tools) && body.tools.some(isWebSearchTool)
})

// ─── OpenAI: /v1/chat/completions and /v1/responses ────────────────────
//
// Both surfaces speak one vendor vocabulary and differ only in where
// they put things, so the signals that do not move (`effort`,
// `thinking`, `toolNames`, `webSearch`) are read by one set of helpers
// and only `tokenize` gets a reader per surface.
//
// These run on the RAW inbound body. The endpoint transformers that
// normalise these shapes (`OpenAITransformer.transformRequestOut` folds
// `reasoning_effort` into `reasoning.effort`;
// `convertResponsesRequestToUnified` turns `input` into `messages`) run
// in the pipeline, which is AFTER `buildRoutePlan` has already routed.
// Reading the normalised shape here is therefore not an option — it does
// not exist yet.

/**
 * OpenAI's reasoning-effort vocabulary mapped onto the router's.
 *
 * `EffortLevel` was written against Anthropic's `output_config.effort`
 * and has no rung below `low`, while OpenAI publishes two: `minimal`
 * and `none`. Both fold onto `low` rather than onto `undefined`, because
 * `undefined` means "the caller said nothing" and `isHeavyRequest` then
 * falls through to escalating on the requested model tier. A caller
 * asking for the cheapest reasoning HAS said something, and `low` is the
 * bucket that suppresses that escalation — which is also the only value
 * an operator can select for it in the Rules screen, whose `effort`
 * predicate is an `EffortLevel` set.
 *
 * `max` is not an OpenAI value. It is accepted anyway so a caller
 * proxying an Anthropic-shaped effort through an OpenAI-compat client
 * is not silently downgraded to "said nothing".
 */
const OPENAI_EFFORT: Partial<Record<string, EffortLevel>> = {
  none: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max'
}

/**
 * The raw effort string, wherever this caller put it.
 *
 * Chat Completions names it `reasoning_effort` at the top level;
 * Responses nests it as `reasoning.effort`. Both spellings are read on
 * both surfaces deliberately: they are one vendor's vocabulary, Rialto's
 * own chat transformer rewrites the flat form into the nested one, and
 * clients in the wild send whichever their SDK version emits.
 */
function openAiEffortValue(body: RouterRequestBody): string | undefined {
  const flat = body.reasoning_effort
  if (typeof flat === 'string' && flat.length > 0) return flat
  const reasoning = body.reasoning
  if (!isObject(reasoning)) return undefined
  const nested = reasoning.effort
  return typeof nested === 'string' && nested.length > 0 ? nested : undefined
}

function openAiEffort(body: RouterRequestBody): EffortLevel | undefined {
  const value = openAiEffortValue(body)
  return value === undefined ? undefined : OPENAI_EFFORT[value]
}

/**
 * Whether the caller asked the model to reason before answering.
 *
 * OpenAI has no `thinking` field, so the question `thinking` actually
 * asks — "did the client opt into extended reasoning?" — has to be read
 * off the reasoning controls. The predicate mirrors the Anthropic one
 * rather than inventing a second rule: there, PRESENCE of `thinking` is
 * the opt-in and `type: 'disabled'` the explicit opt-out; here, presence
 * of a reasoning control is the opt-in and `'none'` — OpenAI's own "do
 * not reason" value — the explicit opt-out.
 *
 * Absence is not an opt-in on either surface even though both vendors
 * reason by default server-side, because the `think` lane grades client
 * INTENT. Treating an omitted field as thinking would put every plain
 * chat completion on the think slot, which is the exact miscount the
 * Anthropic reader's `'disabled'` carve-out exists to avoid.
 *
 * A `reasoning` object carrying no effort still counts: Codex CLI sends
 * `reasoning: {summary: 'auto'}`, and asking for a reasoning summary is
 * asking for reasoning.
 */
function openAiReasoningRequested(body: RouterRequestBody): boolean {
  const value = openAiEffortValue(body)
  if (value !== undefined) return value !== 'none'
  return isObject(body.reasoning)
}

/**
 * Tool identities as OpenAI names them.
 *
 * Chat wraps a function tool as `{type:'function', function:{name}}` and
 * Responses flattens it to `{type:'function', name}`; hosted tools
 * (`web_search`, `file_search`, `code_interpreter`, `mcp`) carry no name
 * on either surface, so their `type` IS their identity. Returned in the
 * vendor's own spelling, because the `hasTool` predicate globs against
 * this list and what an operator types in the Rules screen should be the
 * name their own client sends.
 */
function openAiToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool) => {
    if (!isObject(tool)) return []
    const name = openAiToolName(tool)
    if (name !== undefined) return [name]
    return typeof tool.type === 'string' ? [tool.type] : []
  })
}

/** A tool's declared name, from either the nested or the flat shape. */
function openAiToolName(tool: Record<string, unknown>): string | undefined {
  const nested = isObject(tool.function) ? tool.function.name : undefined
  if (typeof nested === 'string' && nested.length > 0) return nested
  return typeof tool.name === 'string' && tool.name.length > 0 ? tool.name : undefined
}

/**
 * Whether the caller attached OpenAI's hosted web search.
 *
 * Three spellings arrive, all meaning the same thing:
 *   - `{type: 'web_search'}` / `{type: 'web_search_preview'}` — the
 *     hosted tool as Responses declares it. Prefix-matched because
 *     OpenAI versions the type (`web_search_2025_08_26`), the same
 *     reason `isWebSearchTool` prefix-matches Anthropic's.
 *   - a function literally named `web_search` — the Chat wire form, and
 *     the form Rialto's own Responses→Chat converter emits
 *     (`transformers/openai/responses/inbound.ts`), so both sides of the
 *     conversion agree on one spelling.
 *   - top-level `web_search_options` — how Chat Completions enables
 *     search on the `*-search-preview` models, which declare no tool
 *     entry at all.
 */
function openAiWebSearch(body: RouterRequestBody): boolean {
  if (isObject(body.web_search_options)) return true
  // Widened deliberately: `RouterRequestBody.tools` is declared as
  // `TokenizeTool[]`, which is the Anthropic-ish shape, and an OpenAI
  // tool entry has none of its fields.
  const tools: unknown = body.tools
  if (!Array.isArray(tools)) return false
  return tools.some((tool) => {
    if (!isObject(tool)) return false
    if (typeof tool.type === 'string' && tool.type.startsWith('web_search')) return true
    const name = openAiToolName(tool)
    if (name === undefined) return false
    return name.startsWith('web_search')
  })
}

const textBlock = (text: string): TokenizeContentBlock => ({ type: 'text', text })

/**
 * A tool call's arguments as a `tool_use` block.
 *
 * OpenAI carries arguments as a JSON *string* on both surfaces while
 * Anthropic sends the decoded object, and the tokenizer re-serialises
 * whatever `input` holds. Handing it the raw string would make it escape
 * every quote and count an inflated payload, so decode first — and fall
 * back to the string itself when it is not valid JSON, which is what a
 * truncated or hand-rolled call looks like.
 */
function toolUseBlock(args: string): TokenizeContentBlock {
  return { type: 'tool_use', input: decodeToolArguments(args) }
}

function decodeToolArguments(args: string): unknown {
  try {
    const parsed: unknown = JSON.parse(args)
    return parsed
  } catch {
    return args
  }
}

/** Text parts of a content value, in either surface's block spelling. */
function openAiTextBlocks(content: unknown): TokenizeContentBlock[] {
  if (typeof content === 'string') return [textBlock(content)]
  if (!Array.isArray(content)) return []
  // `input_text` / `output_text` (Responses) and `text` (Chat) all put
  // the prose on `.text`, so the discriminator does not need reading.
  // Image parts carry a URL rather than prose and are skipped, matching
  // how the Anthropic reader treats its own image blocks.
  return content.flatMap((part) => (isObject(part) && typeof part.text === 'string' ? [textBlock(part.text)] : []))
}

/**
 * Tool declarations in the shape the tokenizer counts.
 *
 * Chat nests the schema under `function`, Responses puts it flat, and
 * both call the JSON schema `parameters` where `TokenizeTool` calls it
 * `input_schema`. Without this remap an OpenAI caller's tools count as
 * zero tokens — none of `TokenizeTool`'s three fields is where it looks
 * — and a large tool manifest is exactly what pushes an agentic
 * conversation over the longContext threshold. Hosted tools have no
 * schema to weigh and drop out here; `toolNames` still reports them.
 */
function openAiTokenizeTools(tools: unknown): TokenizeTool[] {
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool) => {
    if (!isObject(tool)) return []
    const decl = isObject(tool.function) ? tool.function : tool
    const name = openAiToolName(tool)
    if (name === undefined) return []
    const description = typeof decl.description === 'string' ? decl.description : undefined
    const input_schema = isObject(decl.parameters) ? decl.parameters : {}
    return [description === undefined ? { name, input_schema } : { name, description, input_schema }]
  })
}

/**
 * Chat turns, in the shape the tokenizer counts.
 *
 * `role` / `content` already line up with `TokenizeMessage`, but an
 * assistant turn that calls a tool puts the arguments in `tool_calls[]`
 * and usually leaves `content` null — Anthropic puts the same payload in
 * a `tool_use` content block, which the tokenizer DOES count. Left
 * as-is, every tool call in an agentic conversation weighs zero and a
 * Chat caller never reaches the size-based longContext branch: the same
 * class of undercount as `input` counting zero on Responses.
 */
function openAiChatMessages(messages: unknown): TokenizeMessage[] {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message) => {
    if (!isObject(message)) return []
    const role = typeof message.role === 'string' && message.role.length > 0 ? message.role : 'user'
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    const content = [
      ...openAiTextBlocks(message.content),
      ...calls.flatMap((call) => {
        if (!isObject(call)) return []
        const fn = isObject(call.function) ? call.function : call
        return typeof fn.arguments === 'string' ? [toolUseBlock(fn.arguments)] : []
      })
    ]
    return [{ role, content }]
  })
}

/**
 * Responses turns, in the shape the tokenizer counts.
 *
 * `input` is either a single user string or the item list. The item
 * kinds are the ones `convertResponsesRequestToUnified` accepts, but the
 * target here is `TokenizeMessage`, so a `function_call`'s arguments and
 * a `function_call_output`'s result become the two content blocks the
 * tokenizer knows how to weigh rather than chat's `tool_calls` /
 * `role:'tool'` shapes.
 *
 * `reasoning` items — which Codex CLI echoes back with an
 * `encrypted_content` blob — are skipped: the blob is opaque base64, and
 * counting it with a text encoding would overstate the conversation by
 * far more than omitting it understates it.
 */
function openAiResponsesMessages(input: unknown): TokenizeMessage[] {
  if (typeof input === 'string') return input.length === 0 ? [] : [{ role: 'user', content: input }]
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => (isObject(item) ? responsesInputItem(item) : []))
}

function responsesInputItem(item: Record<string, unknown>): TokenizeMessage[] {
  if (item.type === 'function_call') {
    const args = item.arguments
    return typeof args === 'string' ? [{ role: 'assistant', content: [toolUseBlock(args)] }] : []
  }
  if (item.type === 'function_call_output') {
    // The tokenizer already handles a `tool_result` whose content is
    // either a string or a structure, so `output` passes through as-is.
    return [{ role: 'tool', content: [{ type: 'tool_result', content: item.output }] }]
  }
  if (item.type !== undefined && item.type !== 'message') return []
  const role = typeof item.role === 'string' && item.role.length > 0 ? item.role : 'user'
  return [{ role, content: openAiTextBlocks(item.content) }]
}

const readOpenAiChatSignals: SignalReader = (body) => ({
  // No `system`: Chat carries the system prompt as `messages[0]`, and
  // the surface never receives a top-level one — persona injection is
  // gated to /v1/messages precisely because OpenAI upstreams 400 on it.
  tokenize: {
    messages: openAiChatMessages(body.messages),
    tools: openAiTokenizeTools(body.tools)
  },
  thinking: openAiReasoningRequested(body),
  effort: openAiEffort(body),
  toolNames: openAiToolNames(body.tools),
  webSearch: openAiWebSearch(body)
})

const readOpenAiResponsesSignals: SignalReader = (body) => ({
  tokenize: {
    messages: openAiResponsesMessages(body.input),
    // Responses' top-level system prompt. `TokenizeRequest.system`
    // accepts a bare string, so no block wrapping is needed.
    system: typeof body.instructions === 'string' ? body.instructions : undefined,
    tools: openAiTokenizeTools(body.tools)
  },
  thinking: openAiReasoningRequested(body),
  effort: openAiEffort(body),
  toolNames: openAiToolNames(body.tools),
  webSearch: openAiWebSearch(body)
})

/**
 * Per-surface readers. A surface with no entry falls back to the
 * Anthropic reader, which is what every caller got before this module
 * existed — an unknown surface therefore behaves exactly as it did,
 * rather than losing signals it was previously (accidentally) matching.
 */
const READERS: Partial<Record<string, SignalReader>> = {
  'anthropic-messages': readAnthropicSignals,
  'openai-chat': readOpenAiChatSignals,
  'openai-responses': readOpenAiResponsesSignals,
  'gemini-generate': readGeminiSignals
}

/**
 * Read the routing signals for a request that arrived on `inboundPath`.
 *
 * `inboundPath` is optional on `RouterRequest` for test callers that
 * predate the surface registry; those resolve to the Anthropic reader,
 * preserving the behaviour they were written against.
 */
export function readSignals(body: RouterRequestBody, inboundPath: string | undefined): RouterSignals {
  const surface = surfaceForPath(inboundPath)
  const reader = surface === undefined ? undefined : READERS[surface.id]
  return (reader === undefined ? readAnthropicSignals : reader)(body)
}

/**
 * Signals for a request, computed once and cached on it.
 *
 * Cached because the classifier and every rule predicate ask for the
 * same answers, and a gemini `contents[]` walk is not free. Stored on
 * the request rather than threaded through because that is how the
 * router already carries derived state (`scenarioType`, `tokenCount`).
 */
export function signalsOf(req: {
  body: RouterRequestBody
  inboundPath?: string
  signals?: RouterSignals
}): RouterSignals {
  if (req.signals !== undefined) return req.signals
  const computed = readSignals(req.body, req.inboundPath)
  req.signals = computed
  return computed
}
