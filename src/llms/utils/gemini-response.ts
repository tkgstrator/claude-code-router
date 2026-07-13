/**
 * Gemini → OpenAI-shaped response conversion.
 *
 * Converts both blocking JSON responses and SSE streams emitted by the
 * Gemini `generateContent` / `streamGenerateContent` endpoints into the
 * pipeline's internal OpenAI-flavoured shape (chat completion + chunk).
 * The blocking-JSON branch lives in `./gemini/response-blocking.ts` and
 * the streaming-SSE branch in `./gemini/response-streaming.ts`; shared
 * helpers (usage, annotations, tool calls) live in
 * `./gemini/response-shared.ts`.
 */

import type { Logger } from 'pino'
import { transformBlockingResponse } from './gemini/response-blocking'
import { transformStreamingResponse } from './gemini/response-streaming'

/**
 * Translate a Gemini blocking JSON response or SSE stream into the
 * internal OpenAI-shaped response. Preserves the upstream status,
 * status text, and headers verbatim.
 */
export async function transformResponseOut(
  response: Response,
  providerName: string,
  logger?: Logger
): Promise<Response> {
  const contentType = response.headers.get('Content-Type')
  if (contentType?.includes('application/json')) {
    return transformBlockingResponse(response, providerName, logger)
  }
  if (contentType?.includes('stream')) {
    return transformStreamingResponse(response, providerName, logger)
  }
  // Neither JSON nor stream: return upstream verbatim (mirrors legacy
  // implicit-undefined return).
  return response
}
