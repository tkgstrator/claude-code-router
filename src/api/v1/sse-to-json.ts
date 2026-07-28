/**
 * Aggregate an Anthropic-shape SSE stream back into the non-streaming
 * message envelope the client expects.
 *
 * Needed because a few provider paths (codex-oauth, notably) force
 * `stream=true` upstream even when the inbound client asked for a
 * blocking JSON response. Without this the /v1 handler crashed at
 * `JSON.parse("event: message_start\ndata: ...")`.
 *
 * The reconstruction mirrors Anthropic's SSE contract:
 *   - `message_start`   seeds id/model/role/usage
 *   - `content_block_*` events build the per-index content blocks
 *   - `message_delta`   supplies stop_reason / stop_sequence + updates usage.output_tokens
 *   - `message_stop`    is a no-op envelope marker
 *   - `ping` is ignored
 *
 * Unrecognised event types and malformed events are dropped rather than
 * throwing — a partial reconstruction beats a 500 for the client.
 */

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name?: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: string; [k: string]: unknown }

// Per-index accumulator: start with the block opener as-is, layer deltas
// on top, finalise at content_block_stop (parsing accumulated JSON for
// tool_use inputs).
type BlockState = {
  block: Record<string, unknown>
  jsonParts: string
}

function initBlock(open: unknown): BlockState {
  if (open === null || typeof open !== 'object') return { block: { type: 'text', text: '' }, jsonParts: '' }
  return { block: { ...(open as Record<string, unknown>) }, jsonParts: '' }
}

function applyDelta(state: BlockState, delta: unknown): void {
  if (delta === null || typeof delta !== 'object') return
  const dtype = Reflect.get(delta, 'type')
  if (dtype === 'text_delta') {
    const chunk = Reflect.get(delta, 'text')
    if (typeof chunk === 'string')
      state.block.text = `${typeof state.block.text === 'string' ? state.block.text : ''}${chunk}`
    return
  }
  if (dtype === 'input_json_delta') {
    const chunk = Reflect.get(delta, 'partial_json')
    if (typeof chunk === 'string') state.jsonParts += chunk
    return
  }
  if (dtype === 'thinking_delta') {
    const chunk = Reflect.get(delta, 'thinking')
    if (typeof chunk === 'string') {
      state.block.thinking = `${typeof state.block.thinking === 'string' ? state.block.thinking : ''}${chunk}`
    }
    return
  }
  if (dtype === 'signature_delta') {
    const sig = Reflect.get(delta, 'signature')
    if (typeof sig === 'string') state.block.signature = sig
  }
}

function finaliseBlock(state: BlockState): Block {
  const block = state.block
  if (block.type === 'tool_use') {
    // Anthropic streams tool arguments as a series of partial_json
    // fragments — reassemble + parse at close so the client sees the
    // same shape it would from a non-streaming call.
    if (state.jsonParts.length > 0) {
      try {
        block.input = JSON.parse(state.jsonParts)
      } catch {
        block.input = state.jsonParts
      }
    } else if (!('input' in block)) {
      block.input = {}
    }
  }
  return block as Block
}

// Split an SSE payload into event records. Anthropic separates events
// with a blank line; each event may carry an `event:` label plus one or
// more `data:` lines. We only care about the JSON on the `data:` lines —
// the type is authoritative on the JSON payload itself, so the `event:`
// label is redundant.
function* parseEvents(raw: string): Generator<unknown> {
  for (const chunk of raw.split(/\r?\n\r?\n/)) {
    if (chunk.length === 0) continue
    const dataLines = chunk
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (dataLines.length === 0) continue
    const joined = dataLines.join('\n')
    if (joined === '' || joined === '[DONE]') continue
    try {
      yield JSON.parse(joined)
    } catch {
      // dropped: malformed event
    }
  }
}

// Merge a partial usage bag into the current one — later events (esp.
// message_delta) overwrite output_tokens with the final count.
function mergeUsage(base: unknown, incoming: unknown): Record<string, unknown> {
  const baseObj = base !== null && typeof base === 'object' ? (base as Record<string, unknown>) : {}
  const incObj = incoming !== null && typeof incoming === 'object' ? (incoming as Record<string, unknown>) : {}
  return { ...baseObj, ...incObj }
}

export function isSseContentType(contentType: string | null): boolean {
  return contentType !== null && contentType.toLowerCase().includes('text/event-stream')
}

export async function aggregateAnthropicSseToJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  let message: Record<string, unknown> = {}
  const blockStates = new Map<number, BlockState>()
  const finalisedByIndex = new Map<number, Block>()

  for (const event of parseEvents(text)) {
    if (event === null || typeof event !== 'object') continue
    const type = Reflect.get(event, 'type')
    if (type === 'message_start') {
      const start = Reflect.get(event, 'message')
      if (start !== null && typeof start === 'object') {
        message = { ...(start as Record<string, unknown>) }
      }
      continue
    }
    if (type === 'content_block_start') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      blockStates.set(index, initBlock(Reflect.get(event, 'content_block')))
      continue
    }
    if (type === 'content_block_delta') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      const state = blockStates.get(index)
      if (state) applyDelta(state, Reflect.get(event, 'delta'))
      continue
    }
    if (type === 'content_block_stop') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      const state = blockStates.get(index)
      if (state) {
        finalisedByIndex.set(index, finaliseBlock(state))
        blockStates.delete(index)
      }
      continue
    }
    if (type === 'message_delta') {
      const delta = Reflect.get(event, 'delta')
      if (delta !== null && typeof delta === 'object') {
        message = { ...message, ...(delta as Record<string, unknown>) }
      }
      const usage = Reflect.get(event, 'usage')
      if (usage !== undefined) message.usage = mergeUsage(message.usage, usage)
    }
    // message_stop / ping / anything else — nothing to accumulate.
  }
  // Upstream cut off mid-block: finalise whatever survived so the client
  // still gets something coherent instead of an empty content array.
  for (const [index, state] of blockStates) finalisedByIndex.set(index, finaliseBlock(state))
  const content = [...finalisedByIndex.entries()].sort(([a], [b]) => a - b).map(([, b]) => b)
  message.content = content
  return message
}
