/**
 * Tiktoken-backed tokenizer.
 *
 * Wraps the `tiktoken` package. The default `cl100k_base` encoding is the
 * one Claude / GPT-4 family models use and is also the fallback for any
 * provider that doesn't configure a more specific tokenizer.
 */

import { get_encoding, type Tiktoken, type TiktokenEncoding } from 'tiktoken'
import type { ProviderTokenizerConfig } from '../types'
import { type TokenizeContentBlock, type TokenizeRequest, Tokenizer } from './base'

export class TiktokenTokenizer extends Tokenizer {
  private encoding: Tiktoken | undefined

  /**
   * Accepts either a raw encoding name or a `ProviderTokenizerConfig`
   * whose `model` field is the encoding name. Defaults to `cl100k_base`.
   */
  constructor(encodingOrConfig: TiktokenEncoding | ProviderTokenizerConfig = 'cl100k_base') {
    super()
    const encodingName: TiktokenEncoding =
      typeof encodingOrConfig === 'string'
        ? encodingOrConfig
        : ((encodingOrConfig.model as TiktokenEncoding | undefined) ?? 'cl100k_base')

    try {
      this.encoding = get_encoding(encodingName)
    } catch {
      throw new Error(`Failed to initialize tiktoken encoding: ${encodingName}`)
    }
  }

  override async initialize(): Promise<void> {
    if (!this.encoding) {
      throw new Error('Tiktoken encoding not initialized')
    }
  }

  async countTokens(request: TokenizeRequest): Promise<number> {
    const encoding = this.encoding
    if (!encoding) {
      throw new Error('Encoding not initialized')
    }

    let tokenCount = 0
    const { messages, system, tools } = request

    // Messages
    if (Array.isArray(messages)) {
      for (const message of messages) {
        if (typeof message.content === 'string') {
          tokenCount += encoding.encode(message.content).length
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            tokenCount += this.countContentBlock(encoding, part)
          }
        }
      }
    }

    // System
    if (typeof system === 'string') {
      tokenCount += encoding.encode(system).length
    } else if (Array.isArray(system)) {
      for (const item of system) {
        if (item.type !== 'text') continue
        if (typeof item.text === 'string') {
          tokenCount += encoding.encode(item.text).length
        } else if (Array.isArray(item.text)) {
          for (const textPart of item.text) {
            tokenCount += encoding.encode(textPart ?? '').length
          }
        }
      }
    }

    // Tools
    if (tools) {
      for (const tool of tools) {
        if (tool.description) {
          tokenCount += encoding.encode(tool.name + tool.description).length
        }
        if (tool.input_schema) {
          tokenCount += encoding.encode(JSON.stringify(tool.input_schema)).length
        }
      }
    }

    return tokenCount
  }

  private countContentBlock(encoding: Tiktoken, part: TokenizeContentBlock): number {
    if (part.type === 'text') {
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? encoding.encode(text).length : 0
    }
    if (part.type === 'tool_use') {
      const input = (part as { input?: unknown }).input
      return encoding.encode(JSON.stringify(input ?? '')).length
    }
    if (part.type === 'tool_result') {
      const content = (part as { content?: unknown }).content
      const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
      return encoding.encode(text).length
    }
    return 0
  }
}
