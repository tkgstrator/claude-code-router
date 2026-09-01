/**
 * Abstract transformer base class.
 *
 * Every concrete transformer (Anthropic, OpenAI, Gemini, OAuth subclasses)
 * extends this. The pipeline only cares about the four optional hooks
 * (`transformRequestOut`, `transformRequestIn`, `transformResponseIn`,
 * `transformResponseOut`) plus `auth`. Subclasses override only what
 * they implement; the default impls are no-ops so the pipeline can call
 * them unconditionally.
 */

import type { Logger } from 'pino'
import type {
  RuntimeProvider,
  TransformerAuthResult,
  TransformerContext,
  TransformerHookResult,
  UnifiedChatRequest
} from '@/schemas/domain'

export type { TransformerAuthResult } from '@/schemas/domain/pipeline'
export abstract class Transformer {
  /** Unique name used in provider.transformer.use[] chains. */
  abstract readonly name: string

  /** Optional endpoint path this transformer claims (e.g. /v1/messages). */
  readonly endPoint?: string

  /** Logger injected by the registry at construction time. */
  protected logger?: Logger

  setLogger(logger: Logger): void {
    this.logger = logger
  }

  /**
   * Convert the upstream client's wire request into the unified
   * internal shape. Override on transformers that own an endpoint.
   * Default impl: pass-through (the body already matches the unified
   * shape, e.g. the OAuth claude-code passthrough path).
   */
  // biome-ignore plugin: identity passthrough in the base hook — the unified shape is the same as the inbound wire shape for transformers that don't own an endpoint conversion (claude-code-oauth bypass).
  async transformRequestOut(request: unknown, _context: TransformerContext): Promise<UnifiedChatRequest> {
    return request as UnifiedChatRequest
  }

  /**
   * Adjust the unified request before it hits the provider (provider /
   * model-chain step). Return `{ body, config }` to mutate both, or
   * just a new body.
   */
  async transformRequestIn(
    request: UnifiedChatRequest,
    _provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<TransformerHookResult | UnifiedChatRequest> {
    return request
  }

  /**
   * Reshape the upstream response into the unified internal shape
   * (provider / model-chain step, reverse order from transformRequestIn).
   */
  async transformResponseOut(response: Response, _context: TransformerContext): Promise<Response> {
    return response
  }

  /**
   * Final response shaping owned by the endpoint transformer (e.g.
   * convert OpenAI streaming back to Anthropic SSE for the Claude Code
   * client).
   */
  async transformResponseIn(response: Response, _context?: TransformerContext): Promise<Response> {
    return response
  }

  /**
   * Bypass-mode auth hook. When a provider has a single transformer
   * matching the endpoint transformer, the pipeline skips the full
   * transform chain and only calls this hook to attach upstream creds.
   */
  async auth(
    _request: unknown,
    _provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<TransformerAuthResult | unknown> {
    return _request
  }
}

/**
 * Constructor signature for the registry's static registration path.
 * Some transformers (notably the gemini family) advertise themselves via
 * a `static TransformerName`; everything else is identified by the
 * instance `name` field.
 */
export type TransformerConstructor = {
  new (options?: Record<string, unknown>): Transformer
  TransformerName?: string
}
