/**
 * /v1/* LLM proxy. The single entry the Claude Code client (and ccr)
 * actually targets. Resolves the inbound path to the matching endpoint
 * transformer, runs the app-side pipeline, and relays the upstream
 * response back to the client as JSON or SSE.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getPrismaClient } from '../../db/client'
import {
  getLlmsContext,
  type LlmsContext,
  type ResolvedProvider,
  routeScenario,
  runPipeline,
  type Transformer,
  type UsageRecord
} from '../../llms'
import type { PipelineRequest } from '../../llms/types'
import { requestLogEmitter } from '../request-logs/events'

export const v1Route = new Hono()

// ─── Reasoning-effort normalisation ────────────────────────────────────

const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// Per-model max-supported effort. Claude Code sends body.output_config.effort
// (e.g. 'xhigh'); models that don't support a level — or `effort` at all
// — 400. Normalise BEFORE sending. Ordered low→high so the last entry is
// the model's max supported level.
const EFFORT_BY_MODEL: Record<string, readonly string[]> = {
  'claude-opus-4-7': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-opus-4-6': ['low', 'medium', 'high', 'max'],
  'claude-sonnet-4-6': ['low', 'medium', 'high', 'max'],
  'claude-opus-4-5': ['low', 'medium', 'high']
}

function effortSetFor(model: string): readonly string[] | undefined {
  for (const id of Object.keys(EFFORT_BY_MODEL)) {
    if (model === id || model.startsWith(`${id}-`) || model.startsWith(`${id}@`)) return EFFORT_BY_MODEL[id]
  }
  return undefined
}

function normalizeEffort(body: Record<string, unknown>, model: string): void {
  const oc = body.output_config as { effort?: unknown } | undefined
  const requested = oc?.effort
  if (typeof requested !== 'string') return
  const allowed = effortSetFor(model)
  if (!allowed) {
    delete oc!.effort
    return
  }
  if (!allowed.includes(requested)) oc!.effort = allowed[allowed.length - 1]
}

// ─── Anthropic subscription beta header reshape ────────────────────────

const OAUTH_BETA = 'oauth-2025-04-20'

// Reshape `anthropic-beta` for the subscription (OAuth) path:
//  - drop `context-1m-*`: on a non-1M subscription, opting into 1M
//    rate_limits every request even a tiny "say pong"; degrade to 200K.
//  - ensure OAUTH_BETA is present so premium models route to the
//    subscription allotment instead of org-disabled overage.
function prepareSubscriptionBetas(headers: Record<string, string>): void {
  const raw = headers['anthropic-beta']
  const tokens =
    typeof raw === 'string'
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  const kept = tokens.filter((t) => !t.startsWith('context-1m'))
  if (!kept.includes(OAUTH_BETA)) kept.push(OAUTH_BETA)
  headers['anthropic-beta'] = kept.join(',')
}

// ─── Recursive deep-replace (used by the effort retry path) ────────────

function deepReplaceValue(node: unknown, from: string, to: string): boolean {
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

function bestSupportedLevel(message: string | undefined): { bad: string; level: string } | null {
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

// ─── Upstream-error forwarding ──────────────────────────────────────────

// sendToProvider throws an HTTPException with the exact message
// "Error from provider(<name>,<model>: <status>): <rawBody>" so the
// client sees the genuine upstream error (e.g. Anthropic rate_limit_error)
// rather than our re-wrapped one. Fail fast.
const PROVIDER_ERR_RE = /^Error from provider\([^)]*:\s*(\d+)\):\s*([\s\S]*)$/

function forwardUpstreamError(err: unknown): Response | null {
  if (!(err instanceof HTTPException)) return null
  const message = err.message
  const m = message.match(PROVIDER_ERR_RE)
  if (!m) return null
  const status = Number(m[1]) || err.status || 502
  return new Response(m[2], { status, headers: { 'content-type': 'application/json' } })
}

// ─── Resolve endpoint transformer by inbound path ──────────────────────

function endpointTransformerMap(ctx: LlmsContext): Map<string, Map<string, Transformer>> {
  const map = new Map<string, Map<string, Transformer>>()
  for (const { name, transformer } of ctx.transformers.getWithEndpoint()) {
    const ep = transformer.endPoint!
    if (!map.has(ep)) map.set(ep, new Map())
    map.get(ep)!.set(name, transformer)
  }
  return map
}

// ─── Invocation assembly ────────────────────────────────────────────────

interface Invocation {
  body: Record<string, unknown>
  headers: Record<string, string>
  request: PipelineRequest
  provider: ResolvedProvider
  transformer: Transformer
}

async function buildInvocation(c: Context, ctx: LlmsContext): Promise<Response | Invocation> {
  const url = new URL(c.req.url)
  const path = url.pathname

  const transformersByName = endpointTransformerMap(ctx).get(path)
  if (!transformersByName) {
    return c.json({ type: 'error', error: { type: 'not_found', message: `No handler for ${path}` } }, 404)
  }

  // Default to the first registered transformer at this endpoint —
  // we may swap it below if the routed-to provider has a bypass single-use.
  let transformer: Transformer = transformersByName.values().next().value!

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => {
    headers[k] = v
  })

  const request: PipelineRequest = {
    body,
    headers,
    url: path + url.search
  }

  // Scenario routing: rewrite body.model to the resolved provider,model
  // and stamp req.scenarioType.
  await routeScenario(
    { body: body as PipelineRequest['body'] & { model: string }, log: ctx.log, sessionId: undefined },
    { config: ctx.config, tokenizers: ctx.tokenizers }
  )

  // Split "provider,model" into separate fields.
  const modelField = body.model
  if (typeof modelField !== 'string' || modelField.length === 0) {
    return c.json({ type: 'error', error: { type: 'invalid_request', message: 'Missing model in request body' } }, 400)
  }
  const [providerName, ...rest] = modelField.split(',')
  const model = rest.join(',')
  body.model = model
  request.provider = providerName
  request.model = model

  // Clamp / strip output_config.effort to what the routed-to model
  // supports — BEFORE the upstream call.
  normalizeEffort(body, model)

  // Resolve the provider; an unknown one fails fast.
  const provider = ctx.providers.get(providerName)
  if (!provider) {
    return c.json(
      { type: 'error', error: { type: 'invalid_request', message: `Provider '${providerName}' not found` } },
      400
    )
  }

  // Bypass detection: if the provider has a single transformer that
  // matches the endpoint's path, use it instead of the default at this
  // endpoint. (Same logic the legacy registerApiRoutes used.)
  const soleUseName = provider.transformer?.use?.length === 1 ? provider.transformer.use[0].name : undefined
  if (soleUseName && transformersByName.has(soleUseName)) transformer = transformersByName.get(soleUseName)!

  // Subscription path: subscriptions route through *-oauth transformers.
  // Reshape the anthropic-beta header (drop context-1m, add oauth beta).
  if (typeof soleUseName === 'string' && soleUseName.endsWith('-oauth')) {
    prepareSubscriptionBetas(headers)
  }

  return { body, headers, request, provider, transformer }
}

// ─── Usage capture sink ─────────────────────────────────────────────────

async function recordUsage(entry: UsageRecord): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.session.upsert({
    where: { id: entry.sessionId },
    create: { id: entry.sessionId },
    update: { updatedAt: new Date() }
  })
  await prisma.requestLog.create({ data: { ...entry } })
  requestLogEmitter.emit('new_log', { sessionId: entry.sessionId })
}

// ─── Response formatting ────────────────────────────────────────────────

async function formatResponse(c: Context, response: Response, stream: boolean): Promise<Response> {
  if (!stream) {
    const text = await response.text()
    const json = text.length > 0 ? JSON.parse(text) : {}
    return c.json(json, (response.status || 200) as 200)
  }
  // SSE — relay the upstream stream as-is. Set the headers the Anthropic
  // SDK expects on the inbound client.
  const headers = new Headers({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  // Forward upstream cache / x-ratelimit headers when present.
  for (const [k, v] of response.headers.entries()) {
    if (k.toLowerCase() === 'content-type') continue
    headers.set(k, v)
  }
  return new Response(response.body, { status: response.status, headers })
}

// ─── Handler ────────────────────────────────────────────────────────────

v1Route.post('/v1/*', async (c) => {
  const ctx = await getLlmsContext()
  const built = await buildInvocation(c, ctx)
  if (built instanceof Response) return built
  const { body, headers, request, provider, transformer } = built

  const runOnce = async (): Promise<Response> => {
    const upstream = await runPipeline(
      { body, headers, provider, transformer, context: { req: request } },
      { log: ctx.log, httpsProxy: ctx.config.getHttpsProxy(), recordUsage }
    )
    return formatResponse(c, upstream, body.stream === true)
  }

  try {
    return await runOnce()
  } catch (err) {
    // Forward genuine upstream errors verbatim (Anthropic rate_limit, etc.)
    // before the safety net runs.
    const forwarded = forwardUpstreamError(err)
    if (forwarded) {
      // Retry once if the upstream 400 told us which effort levels it
      // actually supports for this model.
      const message = err instanceof HTTPException ? err.message : ''
      const fix = bestSupportedLevel(message)
      if (fix && deepReplaceValue(body, fix.bad, fix.level)) {
        try {
          return await runOnce()
        } catch (err2) {
          return forwardUpstreamError(err2) ?? errorResponse(c, err2)
        }
      }
      return forwarded
    }

    ctx.log.error({ err }, 'pipeline error')
    return errorResponse(c, err)
  }
})

function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof HTTPException) {
    return c.json({ type: 'error', error: { type: 'internal_error', message: err.message } }, err.status as 500)
  }
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ type: 'error', error: { type: 'internal_error', message } }, 500)
}
