/**
 * OpenAI endpoint transformer. Owns the `/v1/chat/completions` path and
 * is otherwise a pure pass-through — the unified request/response shape
 * already matches OpenAI's wire format, so the base class no-op hooks
 * are sufficient.
 */

import { Transformer } from './base'

export class OpenAITransformer extends Transformer {
  readonly name = 'openai'
  readonly endPoint = '/v1/chat/completions'
}
