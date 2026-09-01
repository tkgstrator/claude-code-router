/**
 * Error envelope shaping for the /v1 surface. The reporter complained
 * about mixed shapes on the same OpenAI-compat surface — `{detail:...}`
 * forwarded from codex sat next to Rialto's own `{type:'error',error:...}`.
 * These helpers translate everything to the shape matching the inbound
 * endpoint.
 */

import { describe, expect, test } from 'bun:test'
import { buildErrorEnvelope, errorShapeForPath, parseUpstreamBody } from '../../src/api/v1/error-shape'

describe('errorShapeForPath', () => {
  test('/v1/messages defaults to Anthropic shape', () => {
    expect(errorShapeForPath('/v1/messages')).toBe('anthropic')
  })

  test('OpenAI-compat paths pick the OpenAI shape', () => {
    expect(errorShapeForPath('/v1/chat/completions')).toBe('openai')
    expect(errorShapeForPath('/v1/responses')).toBe('openai')
    expect(errorShapeForPath('/v1/models')).toBe('openai')
  })

  test('the gemini surface picks the Google shape', () => {
    // Until Phase 3 this collapsed to the Anthropic envelope, which meant
    // a Gemini client would have seen an error body its SDK cannot parse.
    expect(errorShapeForPath('/v1beta/models/gemini-3-pro:generateContent')).toBe('google')
    expect(errorShapeForPath('/v1beta/models/gemini-3-pro:streamGenerateContent')).toBe('google')
  })

  test('unknown / undefined paths fall back to Anthropic (existing behaviour)', () => {
    expect(errorShapeForPath(undefined)).toBe('anthropic')
    expect(errorShapeForPath('/somewhere/else')).toBe('anthropic')
  })
})

describe('buildErrorEnvelope — Google shape', () => {
  test('emits google.rpc.Status: {error:{code,message,status}}', () => {
    // `code` is the HTTP status as a NUMBER — the GenAI SDKs read it as
    // one, and a string there is a silent client-side type error.
    expect(buildErrorEnvelope({ shape: 'google', status: 400, from: 'Missing model' })).toEqual({
      error: { code: 400, message: 'Missing model', status: 'INVALID_ARGUMENT' }
    })
  })

  test('maps the statuses a client actually branches on', () => {
    const statusOf = (http: number): unknown =>
      (buildErrorEnvelope({ shape: 'google', status: http, from: 'x' }).error as Record<string, unknown>).status
    expect(statusOf(401)).toBe('UNAUTHENTICATED')
    expect(statusOf(403)).toBe('PERMISSION_DENIED')
    expect(statusOf(404)).toBe('NOT_FOUND')
    expect(statusOf(429)).toBe('RESOURCE_EXHAUSTED')
    expect(statusOf(500)).toBe('INTERNAL')
    expect(statusOf(503)).toBe('UNAVAILABLE')
  })

  test('an unmapped status says UNKNOWN rather than inventing a name', () => {
    const error = buildErrorEnvelope({ shape: 'google', status: 418, from: 'x' }).error as Record<string, unknown>
    expect(error.status).toBe('UNKNOWN')
    expect(error.code).toBe(418)
  })

  test("preserves the upstream's own status name when Google classified it", () => {
    const env = buildErrorEnvelope({
      shape: 'google',
      status: 429,
      from: { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }
    })
    expect(env).toEqual({
      error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' }
    })
  })

  test('rewraps a non-Google upstream body into the Google envelope', () => {
    // A gemini-surface caller failing over onto a codex provider must
    // still get an envelope its SDK can parse.
    expect(buildErrorEnvelope({ shape: 'google', status: 400, from: { detail: 'Unsupported parameter' } })).toEqual({
      error: { code: 400, message: 'Unsupported parameter', status: 'INVALID_ARGUMENT' }
    })
  })

  test('the via tag lands on the message here too', () => {
    const error = buildErrorEnvelope({ shape: 'google', status: 401, from: 'nope', via: 'google' }).error as Record<
      string,
      unknown
    >
    expect(error.message).toBe('[via google] nope')
  })

  test("google's status name never leaks into the OpenAI envelope's type", () => {
    // The two taxonomies do not overlap; INVALID_ARGUMENT in
    // `error.type` is a string no OpenAI SDK can match on.
    const error = buildErrorEnvelope({
      shape: 'openai',
      status: 400,
      from: { error: { code: 400, message: 'bad', status: 'INVALID_ARGUMENT' } }
    }).error as Record<string, unknown>
    expect(error.type).toBe('invalid_request_error')
  })
})

describe('parseUpstreamBody', () => {
  test('parses JSON body', () => {
    expect(parseUpstreamBody('{"detail":"x"}')).toEqual({ detail: 'x' })
  })

  test('falls back to string on non-JSON body', () => {
    expect(parseUpstreamBody('<html>oops</html>')).toBe('<html>oops</html>')
  })

  test('empty body returns a placeholder object', () => {
    expect(parseUpstreamBody('')).toEqual({ message: 'Empty response from upstream' })
  })
})

describe('buildErrorEnvelope — OpenAI shape', () => {
  test('rewraps codex {detail} into {error:{message,type,code,param}}', () => {
    const env = buildErrorEnvelope({
      shape: 'openai',
      status: 400,
      from: { detail: 'Unsupported parameter: response_format' }
    })
    expect(env).toEqual({
      error: {
        message: 'Unsupported parameter: response_format',
        type: 'invalid_request_error',
        param: null,
        code: null
      }
    })
  })

  test('preserves upstream OpenAI classifiers when present', () => {
    const env = buildErrorEnvelope({
      shape: 'openai',
      status: 429,
      from: {
        error: {
          message: 'You exceeded your current quota',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
          param: null
        }
      }
    })
    expect(env).toEqual({
      error: {
        message: 'You exceeded your current quota',
        type: 'insufficient_quota',
        param: null,
        code: 'insufficient_quota'
      }
    })
  })

  test('handles Anthropic-shape upstream {type:error, error:{...}} translation', () => {
    const env = buildErrorEnvelope({
      shape: 'openai',
      status: 401,
      from: { type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } }
    })
    expect(env).toEqual({
      error: {
        message: 'Invalid API key',
        type: 'authentication_error',
        param: null,
        code: null
      }
    })
  })

  test('maps status to canonical OpenAI type when upstream did not classify', () => {
    const env = buildErrorEnvelope({ shape: 'openai', status: 500, from: 'internal boom' })
    const error = (env.error as Record<string, unknown>)
    expect(error.type).toBe('api_error')
    expect(error.message).toBe('internal boom')
  })

  test('unknown JSON stringifies rather than dropping', () => {
    const env = buildErrorEnvelope({ shape: 'openai', status: 502, from: { foo: 'bar' } })
    expect((env.error as Record<string, unknown>).message).toBe('{"foo":"bar"}')
  })
})

describe('buildErrorEnvelope — Anthropic shape', () => {
  test('emits {type:error, error:{type,message}}', () => {
    const env = buildErrorEnvelope({
      shape: 'anthropic',
      status: 400,
      from: 'Missing model'
    })
    expect(env).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Missing model' }
    })
  })

  test('collapses codex {detail} on the Anthropic side too', () => {
    const env = buildErrorEnvelope({
      shape: 'anthropic',
      status: 429,
      from: { detail: 'rate limit' }
    })
    expect(env).toEqual({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'rate limit' }
    })
  })
})

// `via` — the chained-Rialto-diagnostics knob. Without it, an outer Rialto
// forwarding an inner Rialto's 401 gives the operator no way to tell which
// hop rejected the request; the literal 'Invalid or missing API key.
// Send it as Authorization: Bearer <key>.' collides byte-for-byte with
// the local gate's wording.
describe('buildErrorEnvelope — via provider tag', () => {
  test('OpenAI shape prepends [via <name>] to the message', () => {
    const env = buildErrorEnvelope({
      shape: 'openai',
      status: 401,
      from: {
        error: {
          message: 'Invalid or missing API key. Send it as Authorization: Bearer <key>.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
          param: null
        }
      },
      via: 'openai'
    })
    const error = env.error as Record<string, unknown>
    expect(error.message).toBe(
      '[via openai] Invalid or missing API key. Send it as Authorization: Bearer <key>.'
    )
    // Classifiers still surface — the tag is a message-only prefix.
    expect(error.type).toBe('invalid_request_error')
    expect(error.code).toBe('invalid_api_key')
  })

  test('Anthropic shape prepends the tag too', () => {
    const env = buildErrorEnvelope({
      shape: 'anthropic',
      status: 429,
      from: { detail: 'rate limit' },
      via: 'codex'
    })
    expect(env).toEqual({
      type: 'error',
      error: { type: 'rate_limit_error', message: '[via codex] rate limit' }
    })
  })

  test('is idempotent — a message already tagged with the same provider is not double-wrapped', () => {
    const env = buildErrorEnvelope({
      shape: 'openai',
      status: 500,
      from: '[via openai] boom',
      via: 'openai'
    })
    expect((env.error as Record<string, unknown>).message).toBe('[via openai] boom')
  })

  test('empty / missing via leaves the message untouched', () => {
    const env = buildErrorEnvelope({ shape: 'openai', status: 500, from: 'boom' })
    expect((env.error as Record<string, unknown>).message).toBe('boom')
    const withEmpty = buildErrorEnvelope({ shape: 'openai', status: 500, from: 'boom', via: '' })
    expect((withEmpty.error as Record<string, unknown>).message).toBe('boom')
  })
})
