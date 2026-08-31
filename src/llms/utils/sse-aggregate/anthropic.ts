/**
 * Anthropic `messages` SSE → the non-stream message envelope.
 *
 * The `/v1/messages` surface's `aggregateSse`. Anthropic streams content
 * as indexed blocks that open, receive deltas and close, so the fold is
 * a per-index accumulator rather than a running concatenation — and
 * tool arguments arrive as `partial_json` fragments that are only valid
 * JSON once reassembled at close.
 */

import { parseSseEvents } from './parse'

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name?: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: string; [k: string]: unknown }

type AnthropicBlockState = {
  block: Record<string, unknown>
  jsonParts: string
}

function initAnthropicBlock(open: unknown): AnthropicBlockState {
  if (open === null || typeof open !== 'object') return { block: { type: 'text', text: '' }, jsonParts: '' }
  return { block: { ...(open as Record<string, unknown>) }, jsonParts: '' }
}

function applyAnthropicDelta(state: AnthropicBlockState, delta: unknown): void {
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

function finaliseAnthropicBlock(state: AnthropicBlockState): AnthropicBlock {
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
  return block as AnthropicBlock
}

function mergeUsage(base: unknown, incoming: unknown): Record<string, unknown> {
  const baseObj = base !== null && typeof base === 'object' ? (base as Record<string, unknown>) : {}
  const incObj = incoming !== null && typeof incoming === 'object' ? (incoming as Record<string, unknown>) : {}
  return { ...baseObj, ...incObj }
}

export async function aggregateAnthropicSseToJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  let message: Record<string, unknown> = {}
  const blockStates = new Map<number, AnthropicBlockState>()
  const finalisedByIndex = new Map<number, AnthropicBlock>()

  for (const event of parseSseEvents(text)) {
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
      blockStates.set(index, initAnthropicBlock(Reflect.get(event, 'content_block')))
      continue
    }
    if (type === 'content_block_delta') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      const state = blockStates.get(index)
      if (state) applyAnthropicDelta(state, Reflect.get(event, 'delta'))
      continue
    }
    if (type === 'content_block_stop') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      const state = blockStates.get(index)
      if (state) {
        finalisedByIndex.set(index, finaliseAnthropicBlock(state))
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
  for (const [index, state] of blockStates) finalisedByIndex.set(index, finaliseAnthropicBlock(state))
  const content = [...finalisedByIndex.entries()].sort(([a], [b]) => a - b).map(([, b]) => b)
  message.content = content
  return message
}
