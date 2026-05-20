/**
 * Tokenizer base contract.
 *
 * The pipeline's only consumer (vendor `utils/router.ts`) calls one method
 * on a tokenizer instance: `countTokens(request)` where `request` is the
 * structured Anthropic-style payload (messages + optional system + optional
 * tools). Everything else from the legacy `ITokenizer` (encodeText, dispose,
 * isInitialized, type, name) was only used by the now-unused TokenizerService
 * cache layer, so it is intentionally dropped here.
 *
 * `initialize()` stays optional — tiktoken does its work in the constructor
 * and never needs to be awaited, while the HuggingFace tokenizer must
 * download and parse vocab files before it can count anything.
 */

/**
 * A single content block inside a structured user/assistant message. The
 * Anthropic wire format mixes text, tool calls and tool results; we only
 * peek at the discriminator and the few fields each branch carries.
 */
export type TokenizeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; input: unknown }
  | { type: 'tool_result'; content: string | unknown }
  | { type: string; [extra: string]: unknown }

export interface TokenizeMessage {
  role: string
  content: string | TokenizeContentBlock[]
}

export type TokenizeSystem =
  | string
  | Array<{
      type: string
      text?: string | string[]
    }>

export interface TokenizeTool {
  name: string
  description?: string
  input_schema: object
}

export interface TokenizeRequest {
  messages: TokenizeMessage[]
  system?: TokenizeSystem
  tools?: TokenizeTool[]
}

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
