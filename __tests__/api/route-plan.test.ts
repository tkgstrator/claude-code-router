/**
 * `buildRoutePlan` — the once-per-request stage.
 *
 * Two things here are new and load-bearing for the gemini surface:
 *
 *   1. The endpoint transformer is looked up by the SURFACE's endpoint
 *      pattern, not by the request path. Gemini's transformer registers
 *      at `/v1beta/models/:modelAndAction`, which no concrete request
 *      path ever equals, so a path-keyed lookup 404s every gemini call.
 *   2. The model and the streaming choice are folded out of the URL and
 *      into the body, because every stage after this one reads
 *      `body.model` / `body.stream`.
 *
 * The other three surfaces must be untouched by both, so they are
 * asserted alongside.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import pino from 'pino'
import { buildRoutePlan, type RoutePlan } from '../../src/api/v1/route-plan'
import type { LlmsContext } from '../../src/llms'
import { ConfigStore } from '../../src/llms/registry/config'
import { ProviderRegistry } from '../../src/llms/registry/provider'
import { TokenizerRegistry } from '../../src/llms/registry/tokenizer'
import { TransformerRegistry } from '../../src/llms/registry/transformer'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAITransformer } from '../../src/llms/transformers/openai'
import { __setSurfacesForTests, invalidateSurfaceCache } from '../../src/services/inbound-surface-service'

const log = pino({ level: 'silent' })

const PROVIDERS = [
  {
    name: 'google',
    auth_mode: 'api_key' as const,
    api_style: 'gemini' as const,
    api_key: 'sk-goog',
    api_base_url: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: ['gemini-3-pro']
  }
]

async function buildContext(): Promise<LlmsContext> {
  const transformers = new TransformerRegistry(log)
  transformers.registerMany([new AnthropicTransformer(), new OpenAITransformer(), new GeminiTransformer()])
  const providers = new ProviderRegistry(transformers, log)
  providers.registerFromConfig(PROVIDERS)
  const tokenizers = new TokenizerRegistry(log)
  await tokenizers.initialize()
  const config = new ConfigStore({ Providers: PROVIDERS, providers: PROVIDERS, Router: {} })
  return { config, transformers, providers, tokenizers, log }
}

// Drive buildRoutePlan through a real Hono context, which is the only
// way it reads a body and a URL.
async function plan(path: string, body: Record<string, unknown>): Promise<RoutePlan | Response> {
  const ctx = await buildContext()
  const app = new Hono()
  const captured: { value: RoutePlan | Response | null } = { value: null }
  app.post('/*', async (c) => {
    captured.value = await buildRoutePlan(c, ctx)
    return c.text('ok')
  })
  await app.fetch(
    new Request(`http://local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  )
  return captured.value!
}

const asPlan = (result: RoutePlan | Response): RoutePlan => {
  if (result instanceof Response) throw new Error(`expected a plan, got ${result.status}`)
  return result
}

// Every surface passthrough: the scenario router then returns before it
// can touch the database, and body.model reaches the plan verbatim.
__setSurfacesForTests({})

afterEach(() => {
  __setSurfacesForTests({})
})

describe('the gemini surface', () => {
  test('resolves its transformer through the surface endpoint, not the request path', async () => {
    const result = asPlan(await plan('/v1beta/models/gemini-3-pro:generateContent', { contents: [] }))
    expect([...result.transformersByName.keys()]).toEqual(['gemini'])
    expect(result.defaultTransformer.name).toBe('gemini')
  })

  test('lands the path model on body.model, which is what every later stage reads', async () => {
    const result = asPlan(await plan('/v1beta/models/gemini-3-pro:generateContent', { contents: [] }))
    expect(result.routedBody.model).toBe('gemini-3-pro')
    expect(result.primaryModel).toBe('gemini-3-pro')
    // The client asked for this model by URL; recording it as the
    // requested model is what makes the Activity row honest.
    expect(result.requestedModel).toBe('gemini-3-pro')
  })

  test(':streamGenerateContent sets body.stream, which decides SSE vs JSON on the way back', async () => {
    const streaming = asPlan(await plan('/v1beta/models/gemini-3-pro:streamGenerateContent', { contents: [] }))
    expect(streaming.routedBody.stream).toBe(true)
    const blocking = asPlan(await plan('/v1beta/models/gemini-3-pro:generateContent', { contents: [] }))
    expect(blocking.routedBody.stream).toBe(false)
  })

  test('a provider-qualified model in the path survives intact', async () => {
    const result = asPlan(await plan('/v1beta/models/google,gemini-3-pro:generateContent', { contents: [] }))
    expect(result.primaryModel).toBe('google,gemini-3-pro')
  })

  test('the path wins over a stale body.model', async () => {
    // Google clients do not send one, but if something does, the URL is
    // the request's own statement of what it is calling.
    const result = asPlan(
      await plan('/v1beta/models/gemini-3-pro:generateContent', { model: 'something-else', contents: [] })
    )
    expect(result.primaryModel).toBe('gemini-3-pro')
  })
})

describe('the body-carrying surfaces are untouched', () => {
  test('/v1/messages still reads its model from the body', async () => {
    const result = asPlan(await plan('/v1/messages', { model: 'anthropic,claude-sonnet-5', messages: [] }))
    expect(result.primaryModel).toBe('anthropic,claude-sonnet-5')
    expect(result.defaultTransformer.name).toBe('anthropic')
  })

  test('/v1/chat/completions keeps the stream flag the caller sent', async () => {
    const result = asPlan(await plan('/v1/chat/completions', { model: 'openai,gpt-5', stream: true, messages: [] }))
    expect(result.routedBody.stream).toBe(true)
    expect(result.defaultTransformer.name).toBe('openai')
  })

  test('a missing model on a body-carrying surface is still a 400', async () => {
    const result = await plan('/v1/messages', { messages: [] })
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(400)
  })
})

describe('paths outside the registry', () => {
  test('404 in the caller-neutral Anthropic envelope, as before', async () => {
    const result = await plan('/v1/embeddings', { model: 'x' })
    expect(result).toBeInstanceOf(Response)
    const body = (await (result as Response).json()) as { type?: string }
    expect((result as Response).status).toBe(404)
    expect(body.type).toBe('error')
  })

  test('a gemini-shaped path with no action gets no model folded in', async () => {
    // `/v1beta/models/gemini-3-pro` has no `:action`, so there is nothing
    // to extract; the request fails on the missing model rather than on a
    // truncated one.
    const result = await plan('/v1beta/models/gemini-3-pro', {})
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(400)
  })
})

describe('the error envelope of a failed plan follows the surface', () => {
  test('a gemini 400 answers in google.rpc.Status shape', async () => {
    invalidateSurfaceCache()
    __setSurfacesForTests({})
    const result = await plan('/v1beta/models/gemini-3-pro', {})
    const body = (await (result as Response).json()) as { error?: { status?: string; code?: number } }
    expect(body.error?.status).toBe('INVALID_ARGUMENT')
    expect(body.error?.code).toBe(400)
  })
})
