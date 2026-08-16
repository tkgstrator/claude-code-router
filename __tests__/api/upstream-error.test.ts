/**
 * `forwardUpstreamError` — end-to-end Response-level assertions.
 *
 * The `via` provider tag and the `x-ccr-upstream-url` diagnostic header
 * both round-trip an out-of-band signal from `sendToProvider` (where the
 * outbound URL and provider are known) up to the /v1 error path (where
 * the client-facing Response is built). Verify the wire-observable
 * behaviour so a future refactor of either side can't silently drop the
 * plumbing that closes the "which hop returned this 401" gap.
 */

import { describe, expect, test } from 'bun:test'
import { HTTPException } from 'hono/http-exception'
import { UPSTREAM_URL_SYMBOL, stripUrlSecrets } from '../../src/llms/pipeline/provider-send'
import { forwardUpstreamError } from '../../src/api/v1/upstream-error'

// Reproduce the exception shape sendToProvider throws on upstream error:
// the `Error from provider(...)` message wrap plus the symbol-keyed
// URL. Local helper because the real send path pulls in the whole
// pipeline; the exception's contract is what forwardUpstreamError reads.
function makeUpstreamException(status: number, providerName: string, model: string, body: string, url?: string): HTTPException {
  const message = `Error from provider(${providerName},${model}: ${status}): ${body}`
  // biome-ignore plugin: HTTPException's status param is typed as a closed union of supported codes.
  const exc = new HTTPException(status as never, { message })
  if (url !== undefined) {
    ;(exc as unknown as Record<symbol, unknown>)[UPSTREAM_URL_SYMBOL] = url
  }
  return exc
}

describe('stripUrlSecrets', () => {
  test('drops query params (Gemini ?key=<apiKey> leak)', () => {
    expect(stripUrlSecrets('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=abc123')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
    )
  })

  test('leaves host + path untouched when there is no query', () => {
    expect(stripUrlSecrets('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  test('accepts a URL object', () => {
    const u = new URL('https://api.openai.com/v1/chat/completions?debug=1')
    expect(stripUrlSecrets(u)).toBe('https://api.openai.com/v1/chat/completions')
  })

  test('malformed input still drops anything past the first ?', () => {
    // Fallback path — URL constructor throws on this, so the manual
    // '?' split protects against key leakage even then.
    expect(stripUrlSecrets('not-a-url?key=leak')).toBe('not-a-url')
  })
})

describe('forwardUpstreamError — via + x-ccr-upstream-url headers', () => {
  test('emits both headers when the exception carries a URL', () => {
    const err = makeUpstreamException(
      401,
      'openai',
      'gpt-5.6-luna',
      '{"error":{"message":"boom","type":"invalid_request_error"}}',
      'https://api.openai.com/v1/chat/completions'
    )
    const res = forwardUpstreamError(err, 'openai', 'openai')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    expect(res!.headers.get('x-ccr-upstream')).toBe('openai')
    expect(res!.headers.get('x-ccr-upstream-url')).toBe('https://api.openai.com/v1/chat/completions')
  })

  test('omits x-ccr-upstream-url when the exception did not attach one', () => {
    const err = makeUpstreamException(500, 'openai', 'gpt-5-nano', 'oops')
    const res = forwardUpstreamError(err, 'openai', 'openai')
    expect(res).not.toBeNull()
    expect(res!.headers.get('x-ccr-upstream')).toBe('openai')
    expect(res!.headers.get('x-ccr-upstream-url')).toBeNull()
  })

  test('returns null for non-HTTPException errors (caller falls back to 5xx envelope)', () => {
    expect(forwardUpstreamError(new Error('boom'), 'openai', 'openai')).toBeNull()
  })

  test('returns null when the message does not match the provider-shaped envelope', () => {
    // biome-ignore plugin: intentional out-of-shape input for negative test.
    const err = new HTTPException(500 as never, { message: 'unrelated error' })
    expect(forwardUpstreamError(err, 'openai', 'openai')).toBeNull()
  })
})
