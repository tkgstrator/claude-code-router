import { Hono } from 'hono'
// Vendored llms pipeline, re-exported through llmsContext (@ts-nocheck)
// so these resolve as `any` here. We drive the exact same router +
// transformer chain Fastify used, without Fastify.
import { getLlmsContext, handleTransformerEndpoint, router } from '../../llmsContext'

export const v1Route = new Hono()

// Catch every /v1/* POST, match it against the transformer endpoints
// the llms TransformerService exposes (mirrors registerApiRoutes), and
// run the pipeline directly. Anthropic's transformer registers
// `/v1/messages` — the surface official ccr / Claude Code talk to.
v1Route.post('/v1/*', async (c) => {
  const ctx = await getLlmsContext()
  const url = new URL(c.req.url)
  const path = url.pathname

  const endpointTransformers = new Map<string, Map<string, unknown>>()
  for (const { name, transformer } of ctx.transformerService.getTransformersWithEndpoint()) {
    if (!transformer.endPoint) continue
    if (!endpointTransformers.has(transformer.endPoint)) endpointTransformers.set(transformer.endPoint, new Map())
    endpointTransformers.get(transformer.endPoint)?.set(name, transformer)
  }
  const transformersByName = endpointTransformers.get(path)
  if (!transformersByName) {
    return c.json({ type: 'error', error: { type: 'not_found', message: `No handler for ${path}` } }, 404)
  }
  let transformer = transformersByName.values().next().value

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => {
    headers[k] = v
  })

  const reqShim = {
    body,
    headers,
    url: path + url.search,
    log: ctx.log,
    raw: c.req.raw
  } as Record<string, unknown>

  const replyHeaders: Record<string, string> = {}
  const replyShim = {
    statusCode: 200,
    code(s: number) {
      this.statusCode = s
      return this
    },
    status(s: number) {
      this.statusCode = s
      return this
    },
    header(k: string, v: string) {
      replyHeaders[k] = v
      return this
    },
    type() {
      return this
    },
    send(p: unknown) {
      return p
    }
  }

  // preHandler #1 (router): resolves body.model to "provider,model".
  await router(reqShim, replyShim, {
    configService: ctx.configService,
    tokenizerService: ctx.tokenizerService
  })

  // preHandler #2 (modelProviderMiddleware, ported from llms
  // server.start()): split "provider,model" into req.provider + the
  // bare model the handler/transformers expect.
  const modelField = (body as { model?: unknown }).model
  if (typeof modelField !== 'string' || modelField.length === 0) {
    return c.json({ type: 'error', error: { type: 'invalid_request', message: 'Missing model in request body' } }, 400)
  }
  {
    const [prov, ...rest] = modelField.split(',')
    ;(body as { model: string }).model = rest.join(',')
    reqShim.provider = prov
    reqShim.model = rest
  }

  // Provider with a single transformer enables bypass+auth — pick it.
  const providerName = reqShim.provider as string | undefined
  if (providerName) {
    const provider = ctx.providerService.getProvider(providerName)
    if (provider?.transformer?.use?.length === 1) {
      const useName = provider.transformer.use[0]?.name
      if (useName && transformersByName.has(useName)) transformer = transformersByName.get(useName)
    }
  }

  const fastifyShim = {
    providerService: ctx.providerService,
    transformerService: ctx.transformerService,
    configService: ctx.configService,
    tokenizerService: ctx.tokenizerService,
    log: ctx.log
  }

  try {
    const result = await handleTransformerEndpoint(reqShim, replyShim, fastifyShim, transformer)
    const status = replyShim.statusCode || 200
    if ((body as { stream?: unknown }).stream === true) {
      const h = new Headers({
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      for (const [k, v] of Object.entries(replyHeaders)) h.set(k, v)
      return new Response(result as BodyInit, { status, headers: h })
    }
    return c.json(result as Record<string, unknown>, status as 200)
  } catch (err) {
    const e = err as { statusCode?: number; code?: string; message?: string }
    return c.json(
      { type: 'error', error: { type: e.code ?? 'internal_error', message: e.message ?? 'error' } },
      (e.statusCode ?? 500) as 500
    )
  }
})
