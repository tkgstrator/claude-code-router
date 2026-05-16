import type { Context } from 'hono'
import { Hono } from 'hono'
// Vendored llms pipeline, re-exported through llmsContext (@ts-nocheck)
// so these resolve as `any` here. We drive the exact same router +
// transformer chain Fastify used, without Fastify.
import { getLlmsContext, handleTransformerEndpoint, router } from '../../llmsContext'

export const v1Route = new Hono()

// Recursively replace every string value strictly equal to `from`
// with `to`. Returns true if anything changed.
const deepReplaceValue = (node: unknown, from: string, to: string): boolean => {
  if (!node || typeof node !== 'object') return false
  const obj = node as Record<string | number, unknown>
  const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(obj)
  let changed = false
  for (const k of keys) {
    if (obj[k] === from) {
      obj[k] = to
      changed = true
    } else if (deepReplaceValue(obj[k], from, to)) {
      changed = true
    }
  }
  return changed
}

// Per-model reasoning-effort support, from Anthropic's effort docs.
// Claude Code sends output_config.effort (e.g. 'xhigh'); routed-to
// models that don't support a level — or `effort` at all — 400.
// Normalise BEFORE sending. Ordered low -> high so the last entry is
// the model's max supported level.
const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const EFFORT_BY_MODEL: Record<string, readonly string[]> = {
  'claude-opus-4-7': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-opus-4-6': ['low', 'medium', 'high', 'max'],
  'claude-sonnet-4-6': ['low', 'medium', 'high', 'max'],
  'claude-opus-4-5': ['low', 'medium', 'high']
}

const effortSetFor = (model: string): readonly string[] | undefined => {
  for (const id of Object.keys(EFFORT_BY_MODEL)) {
    if (model === id || model.startsWith(`${id}-`) || model.startsWith(`${id}@`)) return EFFORT_BY_MODEL[id]
  }
  return undefined
}

// Mutate body.output_config.effort to fit `model`: strip it for
// non-effort models, or clamp an unsupported level to the model's top
// supported level (preserving the "strong effort" intent).
const normalizeEffort = (body: unknown, model: string): void => {
  const oc = (body as { output_config?: { effort?: unknown } } | null)?.output_config
  const requested = oc?.effort
  if (typeof requested !== 'string') return
  const allowed = effortSetFor(model)
  if (!allowed) {
    delete (oc as { effort?: unknown }).effort
    return
  }
  if (!allowed.includes(requested)) {
    ;(oc as { effort?: unknown }).effort = allowed[allowed.length - 1]
  }
}

// Highest supported level from a 400's "Supported levels: a, b, c".
const bestSupportedLevel = (message: string | undefined): { bad: string; level: string } | null => {
  const m = message?.match(/does not support effort level '([^']+)'\.\s*Supported levels:\s*([^"}\n]+)/i)
  if (!m) return null
  const supported = m[2]
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (supported.length === 0) return null
  const level =
    [...supported].sort(
      (a, b) =>
        EFFORT_LADDER.indexOf(b as (typeof EFFORT_LADDER)[number]) -
        EFFORT_LADDER.indexOf(a as (typeof EFFORT_LADDER)[number])
    )[0] ?? supported[0]
  return { bad: m[1], level }
}

interface PipeError {
  statusCode?: number
  code?: string
  message?: string
}

// sendRequestToProvider throws this exact shape on a non-ok upstream
// response: "Error from provider(<name>,<model>: <status>): <rawBody>"
// with statusCode = the upstream status. Forward the upstream status +
// original body verbatim so Claude Code sees the genuine Anthropic
// error (e.g. rate_limit_error) and reacts immediately, instead of our
// re-wrapped message. Fail fast — these are never retried here.
const PROVIDER_ERR_RE = /^Error from provider\([^)]*:\s*(\d+)\):\s*([\s\S]*)$/
const errorResponse = (c: Context, e: PipeError) => {
  if (e.code === 'provider_response_error' && typeof e.message === 'string') {
    const m = e.message.match(PROVIDER_ERR_RE)
    if (m) {
      const status = Number(m[1]) || e.statusCode || 502
      return new Response(m[2], {
        status: status as number,
        headers: { 'content-type': 'application/json' }
      })
    }
  }
  return c.json(
    { type: 'error', error: { type: e.code ?? 'internal_error', message: e.message ?? 'error' } },
    (e.statusCode ?? 500) as 500
  )
}

const endpointTransformerMap = (ctx: { transformerService: { getTransformersWithEndpoint(): unknown[] } }) => {
  const map = new Map<string, Map<string, unknown>>()
  for (const { name, transformer } of ctx.transformerService.getTransformersWithEndpoint() as {
    name: string
    transformer: { endPoint?: string }
  }[]) {
    if (!transformer.endPoint) continue
    if (!map.has(transformer.endPoint)) map.set(transformer.endPoint, new Map())
    map.get(transformer.endPoint)?.set(name, transformer)
  }
  return map
}

const makeReplyShim = (replyHeaders: Record<string, string>) => ({
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
})

// Catch every /v1/* POST, match it against the transformer endpoints
// the llms TransformerService exposes (mirrors registerApiRoutes), and
// run the pipeline directly. Anthropic's transformer registers
// `/v1/messages` — the surface official ccr / Claude Code talk to.
v1Route.post('/v1/*', async (c) => {
  const ctx = await getLlmsContext()
  const url = new URL(c.req.url)
  const path = url.pathname

  const transformersByName = endpointTransformerMap(ctx).get(path)
  if (!transformersByName) {
    return c.json({ type: 'error', error: { type: 'not_found', message: `No handler for ${path}` } }, 404)
  }
  let transformer = transformersByName.values().next().value

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => {
    headers[k] = v
  })

  const replyHeaders: Record<string, string> = {}
  const replyShim = makeReplyShim(replyHeaders)
  const reqShim = { body, headers, url: path + url.search, log: ctx.log, raw: c.req.raw } as Record<string, unknown>

  // preHandler #1 (router): resolves body.model to "provider,model".
  await router(reqShim, replyShim, { configService: ctx.configService, tokenizerService: ctx.tokenizerService })

  // preHandler #2 (modelProviderMiddleware, ported from llms
  // server.start()): split "provider,model" into req.provider + the
  // bare model the handler/transformers expect.
  const modelField = (body as { model?: unknown }).model
  if (typeof modelField !== 'string' || modelField.length === 0) {
    return c.json({ type: 'error', error: { type: 'invalid_request', message: 'Missing model in request body' } }, 400)
  }
  const [prov, ...rest] = modelField.split(',')
  ;(body as { model: string }).model = rest.join(',')
  reqShim.provider = prov
  reqShim.model = rest

  // Clamp/strip output_config.effort to what the routed-to model
  // supports — before the upstream call.
  normalizeEffort(body, (body as { model: string }).model)

  // Provider with a single transformer enables bypass+auth — pick it.
  const provider = prov ? ctx.providerService.getProvider(prov) : undefined
  const soleUse = provider?.transformer?.use?.length === 1 ? provider.transformer.use[0]?.name : undefined
  if (soleUse && transformersByName.has(soleUse)) transformer = transformersByName.get(soleUse)

  const fastifyShim = {
    providerService: ctx.providerService,
    transformerService: ctx.transformerService,
    configService: ctx.configService,
    tokenizerService: ctx.tokenizerService,
    log: ctx.log
  }

  const toResponse = (result: unknown) => {
    const status = (replyShim.statusCode || 200) as 200
    if ((body as { stream?: unknown }).stream !== true) {
      return c.json(result as Record<string, unknown>, status)
    }
    const h = new Headers({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    for (const [k, v] of Object.entries(replyHeaders)) h.set(k, v)
    return new Response(result as BodyInit, { status, headers: h })
  }
  const runPipeline = async () =>
    toResponse(await handleTransformerEndpoint(reqShim, replyShim, fastifyShim, transformer))

  try {
    return await runPipeline()
  } catch (err) {
    // Safety net for a model/level combo the matrix doesn't know yet:
    // parse the supported list from the 400 and retry once.
    const fix = bestSupportedLevel((err as PipeError).message)
    if (fix && deepReplaceValue(body, fix.bad, fix.level)) {
      replyShim.statusCode = 200
      for (const k of Object.keys(replyHeaders)) delete replyHeaders[k]
      try {
        return await runPipeline()
      } catch (err2) {
        return errorResponse(c, err2 as PipeError)
      }
    }
    return errorResponse(c, err as PipeError)
  }
})
