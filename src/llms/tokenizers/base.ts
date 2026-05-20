/**
 * Tokenizer base contract.
 *
 * The pipeline's only consumer (scenario router) calls one method on a
 * tokenizer instance: `countTokens(request)` where `request` is the
 * structured Anthropic-style payload (messages + optional system +
 * optional tools). The request shape lives in `@/schemas/llm-tokenizer.dto`
 * so it stays a single source of truth with the rest of the LLM domain.
 *
 * `initialize()` stays optional — tiktoken does its work in the
 * constructor and never needs to be awaited, while the HuggingFace
 * tokenizer must download and parse vocab files before it can count
 * anything.
 */

import type { TokenizeRequest } from '@/schemas'

// Re-export the schema-derived request types so tokenizer implementations
// can `import { Tokenizer, TokenizeRequest, ... } from './base'` without
// having to know that the data shapes live under `@/schemas`.
export type { TokenizeContentBlock, TokenizeMessage, TokenizeRequest, TokenizeSystem, TokenizeTool } from '@/schemas'

/**
 * Minimum surface every concrete tokenizer must implement. Kept as an
 * abstract class (rather than a bare interface) so concrete classes get
 * a default no-op `initialize()` without ceremony.
 */
export abstract class Tokenizer {
  /**
   * Optional async setup hook (download vocab, validate URL, etc.).
   * Default impl is a no-op so eager constructors don't have to override.
   */
  async initialize(): Promise<void> {
    // no-op
  }

  /** Count tokens for the given structured request. */
  abstract countTokens(request: TokenizeRequest): Promise<number>
}
