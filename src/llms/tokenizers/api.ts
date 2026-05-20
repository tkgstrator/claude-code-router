/**
 * Remote-API-backed tokenizer.
 *
 * Posts the structured tokenize request to a provider-hosted counting
 * endpoint (`endpoint` + `apiKey` from `ProviderTokenizerConfig`) and
 * returns the count it reports. Used for closed-source models where we
 * cannot run the tokenizer locally.
 *
 * The simplified envelope (no `requestFormat` / `responseField` knobs) is
 * intentional: the legacy version supported four request formats and a
 * dot-path response selector, but in practice every configured upstream
 * just took `{ messages, system, tools }` and returned `{ token_count }`.
 */

import type { Logger } from 'pino'
import type { ProviderTokenizerConfig } from '@/schemas'
import { type TokenizeRequest, Tokenizer } from './base'

export type ApiTokenizerOptions = {
  /** Network timeout (ms). Defaults to 30s. */
  timeout?: number
  /** Optional pino logger. */
  logger?: Logger
  /** Extra HTTP headers to merge onto the request. */
  headers?: Record<string, string>
}

export class ApiTokenizer extends Tokenizer {
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly extraHeaders: Record<string, string>
  private readonly timeout: number
  private readonly logger: Logger | undefined

  constructor(config: ProviderTokenizerConfig, options: ApiTokenizerOptions = {}) {
    super()
    if (!config.endpoint || !config.apiKey) {
      throw new Error('API tokenizer requires `endpoint` and `apiKey`')
    }
    // Validate URL eagerly so we fail loudly on bad config instead of at
    // first request.
    try {
      new URL(config.endpoint)
    } catch {
      throw new Error(`Invalid API tokenizer endpoint: ${config.endpoint}`)
    }
    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
    this.extraHeaders = options.headers ? options.headers : {}
    this.timeout = options.timeout !== undefined ? options.timeout : 30_000
    this.logger = options.logger
  }

  async countTokens(request: TokenizeRequest): Promise<number> {
    const body = {
      messages: request.messages,
      system: request.system,
      tools: request.tools
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`API tokenizer request failed: ${response.status} ${response.statusText}`)
      }

      const data: unknown = await response.json()
      return this.extractTokenCount(data)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('API tokenizer request timed out')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Pull `token_count` (number) out of the response. Falls back to
   * `usage.input_tokens` for Anthropic-shaped responses since that's
   * the only other format we've ever seen in the wild.
   */
  private extractTokenCount(data: unknown): number {
    if (!isRecord(data)) {
      throw this.invalidResponse(data, 'response is not an object')
    }
    if (typeof data.token_count === 'number') {
      return data.token_count
    }
    if (isRecord(data.usage) && typeof data.usage.input_tokens === 'number') {
      return data.usage.input_tokens
    }
    throw this.invalidResponse(data, 'no numeric `token_count` or `usage.input_tokens` field')
  }

  private invalidResponse(data: unknown, reason: string): Error {
    this.logger?.error(`Invalid response from API tokenizer (${reason}). Response: ${JSON.stringify(data)}`)
    return new Error(`Invalid response from API tokenizer: ${reason}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
