/**
 * Error envelope shaping for the /v1 surface. The reporter complained
 * about mixed shapes on the same OpenAI-compat surface — `{detail:...}`
 * forwarded from codex sat next to CCR's own `{type:'error',error:...}`.
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

  test('unknown / undefined paths fall back to Anthropic (existing behaviour)', () => {
    expect(errorShapeForPath(undefined)).toBe('anthropic')
    expect(errorShapeForPath('/somewhere/else')).toBe('anthropic')
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

// `via` — the chained-CCR-diagnostics knob. Without it, an outer CCR
// forwarding an inner CCR's 401 gives the operator no way to tell which
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
