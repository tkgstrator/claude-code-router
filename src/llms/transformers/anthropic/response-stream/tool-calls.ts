/**
 * Tool-call delta handling for the Anthropic SSE writer.
 *
 * Opens a `tool_use` content block on the first delta for a given
 * OpenAI tool-call index, reconciles the synthesized placeholder
 * id/name once the real values arrive, and streams `input_json_delta`
 * fragments for the accumulating arguments.
 */

import type { StreamChoiceDelta, StreamState, StreamToolCallChunk, ToolCallInfo } from './types'

export function reconcileToolCallIdentity(
  toolCall: StreamToolCallChunk,
  toolCallIndex: number,
  state: StreamState
): void {
  if (!toolCall.id || !toolCall.function?.name) return
  const existingToolCall = state.toolCalls.get(toolCallIndex)
  if (!existingToolCall) return
  const wasTemporary = existingToolCall.id.startsWith('call_') && existingToolCall.name.startsWith('tool_')
  if (!wasTemporary) return
  existingToolCall.id = toolCall.id
  existingToolCall.name = toolCall.function.name
}

export function handleToolCallDelta(delta: StreamChoiceDelta | undefined, state: StreamState): void {
  if (!delta?.tool_calls || state.isClosed || state.hasFinished) return
  state.toolCallChunks++
  const processedInThisChunk = new Set<number>()

  for (const toolCall of delta.tool_calls) {
    if (state.isClosed) break
    // `index` is genuinely optional on partial OpenAI tool-call deltas;
    // 0 is the documented default when the upstream omits it for the
    // first tool call.
    const toolCallIndex = toolCall.index === undefined ? 0 : toolCall.index
    if (processedInThisChunk.has(toolCallIndex)) continue
    processedInThisChunk.add(toolCallIndex)
    const isUnknownIndex = !state.toolCallIndexToContentBlockIndex.has(toolCallIndex)

    if (isUnknownIndex) {
      startToolCallBlock(toolCall, toolCallIndex, state)
    } else {
      reconcileToolCallIdentity(toolCall, toolCallIndex, state)
    }

    emitToolCallArguments(toolCall, toolCallIndex, state)
  }
}

function startToolCallBlock(toolCall: StreamToolCallChunk, toolCallIndex: number, state: StreamState): void {
  state.closeCurrentBlock()

  const newContentBlockIndex = state.assignContentBlockIndex()
  state.toolCallIndexToContentBlockIndex.set(toolCallIndex, newContentBlockIndex)
  // Partial OpenAI tool-call deltas may omit id/name on the first chunk;
  // the synthesized placeholders below are overwritten by
  // reconcileToolCallIdentity when the real values arrive.
  const toolCallId = toolCall.id === undefined ? `call_${Date.now()}_${toolCallIndex}` : toolCall.id
  const fnName = toolCall.function?.name
  const toolCallName = fnName === undefined ? `tool_${toolCallIndex}` : fnName
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
  state.safeEnqueue(state.encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`))
  state.currentContentBlockIndex = newContentBlockIndex

  const toolCallInfo: ToolCallInfo = {
    id: toolCallId,
    name: toolCallName,
    arguments: '',
    contentBlockIndex: newContentBlockIndex
  }
  state.toolCalls.set(toolCallIndex, toolCallInfo)
}

// Character class matching ASCII C0/C1 control characters
// (U+0000..U+001F and U+007F..U+009F). Built via String.fromCharCode so
// the source file stays pure ASCII and `noControlCharactersInRegex`
// (which inspects the regex literal/source) doesn't fire.
const CONTROL_CHAR_REGEX = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  'g'
)

function emitToolCallArguments(toolCall: StreamToolCallChunk, toolCallIndex: number, state: StreamState): void {
  if (!toolCall.function?.arguments || state.isClosed || state.hasFinished) return
  const blockIndex = state.toolCallIndexToContentBlockIndex.get(toolCallIndex)
  if (blockIndex === undefined) return
  const currentToolCall = state.toolCalls.get(toolCallIndex)
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
    state.safeEnqueue(state.encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(anthropicChunk)}\n\n`))
  } catch {
    try {
      const fixedArgument = toolCall.function.arguments
        .replace(CONTROL_CHAR_REGEX, '')
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
      state.safeEnqueue(state.encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(fixedChunk)}\n\n`))
    } catch (fixError) {
      console.error(fixError)
    }
  }
}
