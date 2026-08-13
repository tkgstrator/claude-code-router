/**
 * Time helpers shared across transformer modules.
 *
 * `nowSeconds` returns the current UNIX time in whole seconds — the
 * canonical `created` / `created_at` value emitted by OpenAI-shaped
 * response envelopes. Previously duplicated across the OpenAI Responses
 * and Gemini response converters.
 */

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
