/**
 * /v1/* LLM proxy. The single entry the Claude Code client (and ccr)
 * actually targets. Resolves the inbound path to the matching endpoint
 * transformer, runs the app-side pipeline, and relays the upstream
 * response back to the client as JSON or SSE.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type PipelineRequest, RecordSchema, type Router } from '@/schemas'
import { getPrismaClient } from '../../db/client'
import {
  getLlmsContext,
  type LlmsContext,
  type ResolvedProvider,
  type RouterRequest,
  routeScenario,
  runPipeline,
  type ScenarioType,
  type Transformer,
  type UsageRecord
} from '../../llms'
import { isProviderExhausted, markProviderExhausted } from '../../services/failover-state'
import { requestLogEmitter } from '../request-logs/events'

export const v1Route = new Hono()

// ─── Reasoning-effort normalisation ────────────────────────────────────

const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// Per-model max-supported effort. Claude Code sends body.output_config.effort
// (e.g. 'xhigh'); models that don't support a level — or `effort` at all
// — 400. Normalise BEFORE sending. Ordered low→high so the last entry is
// the model's max supported level.
const EFFORT_BY_MODEL: Record<string, readonly string[]> = {
  'claude-fable-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-mythos-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-opus-4-7': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-opus-4-8': ['low', 'medium', 'high', 'xhigh', 'max'],
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

// Upstream statuses that mean "this model can't serve right now, move to
// the next fallback": 429 is the subscription / plan rate-limit ceiling
// the user hits. Kept narrow on purpose — genuine 4xx (bad request,
// auth) should surface, not silently re-route.
const FAILOVER_STATUSES = new Set([429])

function isRateLimited(err: unknown): boolean {
  if (!(err instanceof HTTPException)) return false
  const m = err.message.match(PROVIDER_ERR_RE)
  const status = m ? Number(m[1]) : err.status
  return FAILOVER_STATUSES.has(status)
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

// Resolved once per inbound request, before any model is picked off the
// failover chain. routeScenario has run, so `primaryModel` is the
// "provider,model" it landed on and `scenarioType` selects the matching
// fallback chain. `routedBody` is the post-routeScenario body BEFORE
// per-model shaping (effort clamp, internal-field strip) so every chain
// attempt re-derives those from a clean copy.
interface RoutePlan {
  routedBody: Record<string, unknown>
  headers: Record<string, string>
  transformersByName: Map<string, Transformer>
  defaultTransformer: Transformer
  scenarioType: ScenarioType
  primaryModel: string
  path: string
  search: string
}

// A single model's fully-resolved invocation, ready for the pipeline.
interface ResolvedInvocation {
  body: Record<string, unknown>
  headers: Record<string, string>
  request: PipelineRequest
  provider: ResolvedProvider
  transformer: Transformer
}

async function buildRoutePlan(c: Context, ctx: LlmsContext): Promise<Response | RoutePlan> {
  const url = new URL(c.req.url)
  const path = url.pathname

  const transformersByName = endpointTransformerMap(ctx).get(path)
  if (!transformersByName) {
    return c.json({ type: 'error', error: { type: 'not_found', message: `No handler for ${path}` } }, 404)
  }
  // First registered transformer at this endpoint; resolveInvocationForModel
  // may swap it per-model if the routed-to provider has a bypass single-use.
  const defaultTransformer: Transformer = transformersByName.values().next().value!

  const bodyParsed = RecordSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!bodyParsed.success) {
    return c.json(
      {
        type: 'error',
        error: { type: 'invalid_request', message: 'Request body must be a JSON object' }
      },
      400
    )
  }
  const body = bodyParsed.data
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => {
    headers[k] = v
  })

  // Scenario routing: rewrite body.model to the resolved provider,model
  // and stamp req.scenarioType. We keep the request object so we can read
  // the scenario back — it selects the failover chain below.
  const routeReq: RouterRequest = {
    body: body as PipelineRequest['body'] & { model: string },
    log: ctx.log,
    sessionId: undefined
  }
  await routeScenario(routeReq, { config: ctx.config, tokenizers: ctx.tokenizers })
  const scenarioType: ScenarioType = routeReq.scenarioType !== undefined ? routeReq.scenarioType : 'default'

  const primaryModel = typeof body.model === 'string' ? body.model : ''
  if (primaryModel.length === 0) {
    return c.json({ type: 'error', error: { type: 'invalid_request', message: 'Missing model in request body' } }, 400)
  }

  return {
    routedBody: body,
    headers,
    transformersByName,
    defaultTransformer,
    scenarioType,
    primaryModel,
    path,
    search: url.search
  }
}

// Resolve one "provider,model" string into a ready-to-run invocation, or
// null when the model can't be used (malformed string / unknown
// provider) — the caller skips a null and moves to the next chain entry.
function resolveInvocationForModel(plan: RoutePlan, modelString: string, ctx: LlmsContext): ResolvedInvocation | null {
  const [providerName, ...rest] = modelString.split(',')
  const model = rest.join(',')
  if (!providerName || model.length === 0) {
    ctx.log.warn({ modelString }, 'failover: malformed provider,model; skipping')
    return null
  }

  const provider = ctx.providers.get(providerName)
  if (!provider) {
    ctx.log.warn({ providerName }, 'failover: provider not found; skipping')
    return null
  }

  // Fresh per-attempt body / headers so per-model shaping (effort clamp,
  // internal-field strip, subscription beta reshape) never leaks across
  // chain attempts.
  const body: Record<string, unknown> = { ...plan.routedBody }
  const headers: Record<string, string> = { ...plan.headers }
  body.model = model

  // Clamp / strip output_config.effort to what the routed-to model
  // supports — BEFORE the upstream call.
  normalizeEffort(body, model)

  // Consume and remove CCR-internal extensions that Claude Code adds for
  // CCR-specific features (context management, diagnostics, effort tuning).
  // These must not reach any upstream provider API.
  delete body.context_management
  delete body.output_config
  delete body.diagnostics

  // Bypass detection: if the provider has a single transformer that
  // matches the endpoint's path, use it instead of the default at this
  // endpoint. (Same logic the legacy registerApiRoutes used.)
  const soleUseName = provider.transformer?.use?.length === 1 ? provider.transformer.use[0].name : undefined
  const swapped =
    soleUseName && plan.transformersByName.has(soleUseName) ? plan.transformersByName.get(soleUseName) : undefined
  const transformer: Transformer = swapped !== undefined ? swapped : plan.defaultTransformer

  // Subscription path: subscriptions route through *-oauth transformers.
  // Reshape the anthropic-beta header (drop context-1m, add oauth beta).
  if (typeof soleUseName === 'string' && soleUseName.endsWith('-oauth')) {
    prepareSubscriptionBetas(headers)
  }

  const request: PipelineRequest = {
    body,
    headers,
    url: plan.path + plan.search,
    provider: providerName,
    model,
    scenarioType: plan.scenarioType
  }

  return { body, headers, request, provider, transformer }
}

function providerNameOf(modelString: string): string {
  return modelString.split(',')[0]
}

// Ordered list of "provider,model" candidates for this request: the
// scenario's primary first, then its configured fallback chain. Skips
// providers currently known to be rate-limited, but never returns empty
// — if every candidate is exhausted we still try them (the window may
// have reset since we last marked it).
function buildFailoverChain(plan: RoutePlan, ctx: LlmsContext): string[] {
  const router = ctx.config.get<Router>('Router')
  const configured = router?.fallbacks?.[plan.scenarioType]
  const fallbacks = Array.isArray(configured) ? configured : []

  const seen = new Set<string>()
  const ordered = [plan.primaryModel, ...fallbacks].filter((m) => {
    if (seen.has(m)) return false
    seen.add(m)
    return true
  })

  const live = ordered.filter((m) => !isProviderExhausted(providerNameOf(m)))
  return live.length > 0 ? live : ordered
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
  // Strip encoding headers: Bun's fetch auto-decompresses the body, so
  // content-encoding / transfer-encoding no longer describe what we send.
  // Forwarding them would cause Claude Code to attempt double-decompression
  // (ZlibError).
  const SKIP = new Set(['content-type', 'content-encoding', 'transfer-encoding'])
  for (const [k, v] of response.headers.entries()) {
    if (SKIP.has(k.toLowerCase())) continue
    headers.set(k, v)
  }
  return new Response(response.body, { status: response.status, headers })
}

// ─── Handler ────────────────────────────────────────────────────────────

v1Route.post('/v1/*', async (c) => {
  const ctx = await getLlmsContext()
  const plan = await buildRoutePlan(c, ctx)
  if (plan instanceof Response) return plan

  const chain = buildFailoverChain(plan, ctx)

  const runWith = async (inv: ResolvedInvocation): Promise<Response> => {
    const upstream = await runPipeline(
      {
        body: inv.body,
        headers: inv.headers,
        provider: inv.provider,
        transformer: inv.transformer,
        context: { req: inv.request }
      },
      { log: ctx.log, httpsProxy: ctx.config.getHttpsProxy(), recordUsage }
    )
    return formatResponse(c, upstream, inv.body.stream === true)
  }

  // One model attempt with the effort-level retry folded in: if the
  // upstream 400 told us which effort levels it supports, swap and retry
  // once against the SAME model before bubbling the error up to the
  // failover loop.
  const attempt = async (inv: ResolvedInvocation): Promise<Response> => {
    try {
      return await runWith(inv)
    } catch (err) {
      if (forwardUpstreamError(err)) {
        const message = err instanceof HTTPException ? err.message : ''
        const fix = bestSupportedLevel(message)
        if (fix && deepReplaceValue(inv.body, fix.bad, fix.level)) {
          return await runWith(inv)
        }
      }
      throw err
    }
  }

  let lastForwarded: Response | null = null
  for (let i = 0; i < chain.length; i++) {
    const inv = resolveInvocationForModel(plan, chain[i], ctx)
    if (inv === null) continue

    try {
      return await attempt(inv)
    } catch (err) {
      const forwarded = forwardUpstreamError(err)

      // Rate-limited: remember it, and fail over to the next chain entry
      // when there is one. Keep the forwarded body so we can still return
      // the genuine upstream error if every candidate ends up limited.
      if (forwarded && isRateLimited(err)) {
        markProviderExhausted(inv.provider.name)
        lastForwarded = forwarded
        ctx.log.warn(
          { provider: inv.provider.name, model: inv.request.model, scenario: plan.scenarioType },
          'rate limited; failing over to next fallback model'
        )
        continue
      }

      // Any other forwardable upstream error (auth, bad request, ...) is
      // surfaced verbatim — re-routing those would hide real problems.
      if (forwarded) return forwarded

      ctx.log.error({ err }, 'pipeline error')
      return errorResponse(c, err)
    }
  }

  // Chain exhausted: every candidate was rate-limited (or unresolvable).
  if (lastForwarded) return lastForwarded
  return c.json({ type: 'error', error: { type: 'invalid_request', message: 'No usable model for this request' } }, 400)
})

function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof HTTPException) {
    return c.json({ type: 'error', error: { type: 'internal_error', message: err.message } }, err.status as 500)
  }
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ type: 'error', error: { type: 'internal_error', message } }, 500)
}
