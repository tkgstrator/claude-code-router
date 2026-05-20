/**
 * Gemini endpoint transformer.
 *
 * Owns `/v1beta/models/:modelAndAction`. The body / response shape work
 * is delegated to the shared gemini-conversion util (`buildRequestBody`,
 * `transformRequestOut`, `transformResponseOut`) because the same
 * conversion is reused by vertex-gemini.
 */

import type { RuntimeProvider, TransformerContext, TransformerHookResult, UnifiedChatRequest } from '@/schemas'
import { buildRequestBody, transformRequestOut, transformResponseOut } from '../utils/gemini-conversion'
import { Transformer } from './base'

export class GeminiTransformer extends Transformer {
  readonly name = 'gemini'
  readonly endPoint = '/v1beta/models/:modelAndAction'

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<TransformerHookResult> {
    return {
      body: buildRequestBody(request),
      config: {
        url: new URL(
          `./${request.model}:${request.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
          provider.api_base_url
        ),
        headers: {
          'x-goog-api-key': provider.api_key,
          Authorization: undefined
        }
      }
    }
  }

  async transformRequestOut(request: unknown, _context: TransformerContext): Promise<UnifiedChatRequest> {
    return transformRequestOut(toGeminiRequestRecord(request))
  }

  async transformResponseOut(response: Response, _context: TransformerContext): Promise<Response> {
    return transformResponseOut(response, this.name, this.logger)
  }
}

function toGeminiRequestRecord(request: unknown): Record<string, unknown> {
  if (request === null || typeof request !== 'object') return {}
  return request as Record<string, unknown>
}
