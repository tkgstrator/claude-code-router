/**
 * /v1/* LLM proxy. The single entry the Claude Code client (and ccr)
 * actually targets. Resolves the inbound path to the matching endpoint
 * transformer, runs the app-side pipeline, and relays the upstream
 * response back to the client as JSON or SSE.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Logger } from 'pino'
import { getPrismaClient } from '../../db/client'
import { getLlmsContext, type MessageRecord, runPipeline, type UsageRecord } from '../../llms'
import { INBOUND_SURFACES, surfaceForPath } from '../../llms/inbound/surfaces'
import { requestLogEmitter } from '../request-logs/events'
import { buildFailoverChain } from './candidate-chain'
import { attemptChainEntry, type ChainCtx, type SubscriptionKindProvider, sessionIdFrom } from './chain-failover'
import { buildErrorEnvelope, errorShapeForPath } from './error-shape'
import type { ResolvedInvocation } from './invocation'
import { redactToolArguments } from './redact'
import { buildRoutePlan } from './route-plan'
import { aggregateAnthropicSseToJson, isSseContentType } from './sse-to-json'
import { bestSupportedLevel, deepReplaceValue, forwardUpstreamError } from './upstream-error'

export const v1Route = new Hono()

// ─── Usage capture sink ─────────────────────────────────────────────────

/**
 * Envelope switch, read per request rather than at boot.
 *
 * The reason to turn capture off is usually that something is being
 * recorded right now that should not be, so waiting for a restart is
 * the wrong behaviour. Absent reads as on, which is what capture did
 * before these keys existed.
 */
const captureEnabled = (key: 'CAPTURE_REQUESTS' | 'CAPTURE_MESSAGES'): boolean => process.env[key] !== 'false'

async function recordUsage(entry: UsageRecord): Promise<void> {
  if (!captureEnabled('CAPTURE_REQUESTS')) return
  const prisma = getPrismaClient()
  // New activity un-archives a previously archived session so it returns to
  // the History list (archivedAt: null), while still bumping updatedAt.
  // inboundType is set on the CREATE branch only — first-observed sticks so
  // a rare session-id reuse across wire formats does not silently flip the
  // tag on the History list. Null when the row was pre-migration or the
  // path did not carry a known inbound type.
  await prisma.session.upsert({
    where: { id: entry.sessionId },
    create: { id: entry.sessionId, inboundType: entry.inboundType ?? null },
    update: { updatedAt: new Date(), archivedAt: null }
  })
  await prisma.requestLog.create({ data: { ...entry } })
  requestLogEmitter.emit('new_log', { sessionId: entry.sessionId })
}

// Chat-view archive. Best-effort — the pipeline fires this fire-and-forget
// so a DB write failure never disturbs the upstream call. Upserts the
// Session first because the user turn can land before recordUsage has
// created it.
async function recordMessages(entries: MessageRecord[]): Promise<void> {
  if (entries.length === 0 || !captureEnabled('CAPTURE_MESSAGES')) return
  const redact = process.env.REDACT_TOOL_ARGUMENTS === 'true'
  const prisma = getPrismaClient()
  const sessionIds = new Set(entries.map((e) => e.sessionId))
  for (const id of sessionIds) {
    await prisma.session.upsert({
      where: { id },
      create: { id },
      update: { updatedAt: new Date(), archivedAt: null }
    })
  }
  await prisma.message.createMany({
    // biome-ignore plugin: MessageRecord.content is unknown by wire schema (Anthropic block arrays and user content shapes vary); Prisma InputJsonValue wants a concrete JSON value. The pipeline only passes wire-safe values here.
    data: entries.map((e) => ({
      sessionId: e.sessionId,
      role: e.role,
      content: (redact ? redactToolArguments(e.content) : e.content) as never
    }))
  })
}

// ─── Response formatting ────────────────────────────────────────────────

// Tee the upstream SSE body through a Transform that counts `data:` lines
// and total bytes; on flush (end-of-stream) fire a warn when nothing came
// through. This surfaces the "HTTP 200 but empty body" case that Claude
// Code shows as "API returned an empty or malformed response" — until now
// CCR silently relayed the empty stream and the operator had no signal.
function countingSseTransform(
  log: Logger,
  ctx: { provider: string; model: string | undefined; status: number }
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const state = { bytes: 0, events: 0, buffer: '' }
  return new TransformStream({
    transform(chunk, controller) {
      state.bytes += chunk.byteLength
      state.buffer += decoder.decode(chunk, { stream: true })
      let nl = state.buffer.indexOf('\n')
      while (nl !== -1) {
        const line = state.buffer.slice(0, nl)
        if (line.startsWith('data:')) state.events++
        state.buffer = state.buffer.slice(nl + 1)
        nl = state.buffer.indexOf('\n')
      }
      controller.enqueue(chunk)
    },
    flush() {
      if (state.events === 0) {
        log.warn(
          { provider: ctx.provider, model: ctx.model, status: ctx.status, bytes: state.bytes },
          'upstream sse stream closed with 0 events'
        )
      }
    }
  })
}

// The SSE→JSON aggregator that matches the inbound surface. The upstream
// response has already been reshaped by the endpoint transformer's
// `transformResponseIn` into the inbound wire form, so the aggregator
// only needs to know which wire shape that is — which is the surface's
// own answer, and now lives on its descriptor.
//
// This used to dispatch on `transformer.name`. That read the same answer
// off a different object: a transformer is only reachable here through
// the endpoint it registered, so surface and transformer were 1:1 and
// the two dispatches could not disagree. Asking the surface is simply
// asking the thing that knows.
//
// Unknown paths (the /v1/* catch-all's 404 lane) keep the Anthropic
// aggregator they have always had.
function pickSseAggregator(path: string): (response: Response) => Promise<Record<string, unknown>> {
  const surface = surfaceForPath(path)
  return surface !== undefined ? surface.aggregateSse : aggregateAnthropicSseToJson
}

async function formatResponse(
  c: Context,
  response: Response,
  stream: boolean,
  log: Logger,
  observed: { provider: string; model: string | undefined; path: string }
): Promise<Response> {
  if (!stream) {
    // A few provider paths (codex-oauth notably) force stream=true
    // upstream even when the client asked for blocking JSON. Detect
    // SSE by content-type and aggregate the events back into the
    // non-stream envelope that matches the inbound endpoint; only fall
    // through to JSON.parse when the upstream really is JSON. Without
    // this the parse throws on "event: ...\ndata: ..." and the client
    // sees a 500.
    if (isSseContentType(response.headers.get('content-type'))) {
      const aggregate = pickSseAggregator(observed.path)
      const message = await aggregate(response)
      return c.json(message, (response.status || 200) as 200)
    }
    const text = await response.text()
    if (text.length === 0) {
      log.warn(
        {
          provider: observed.provider,
          model: observed.model,
          status: response.status,
          contentType: response.headers.get('content-type')
        },
        'upstream returned empty body — client will see malformed 200'
      )
    }
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
  // Wrap the upstream body in a passthrough Transform that counts SSE
  // events, so a 0-event close surfaces as a warn instead of silently
  // relaying an empty stream.
  const body = response.body
    ? response.body.pipeThrough(
        countingSseTransform(log, {
          provider: observed.provider,
          model: observed.model,
          status: response.status
        })
      )
    : response.body
  return new Response(body, { status: response.status, headers })
}

function errorResponse(c: Context, err: unknown): Response {
  const shape = errorShapeForPath(new URL(c.req.url).pathname)
  const status = err instanceof HTTPException ? err.status : 500
  const message = err instanceof Error ? err.message : String(err)
  const envelope = buildErrorEnvelope({ shape, status, from: message })
  return c.json(envelope, status as 500)
}

// ─── Handler ────────────────────────────────────────────────────────────

const handleInbound = async (c: Context): Promise<Response> => {
  const ctx = await getLlmsContext()
  const planOrResponse = await buildRoutePlan(c, ctx)
  if (planOrResponse instanceof Response) return planOrResponse
  const plan = planOrResponse

  const chain = buildFailoverChain(plan, ctx)
  const providers = ctx.config.get<SubscriptionKindProvider[]>('providers', [])
  const sessionId = sessionIdFrom(plan.headers)

  const runWith = async (inv: ResolvedInvocation): Promise<Response> => {
    // Snapshot the client's stream preference BEFORE the pipeline runs.
    // Some provider transformers (codex-oauth notably) force `stream = true`
    // on the body they hand to the upstream and mutate `inv.body` in
    // place; without this snapshot `formatResponse` would see the
    // mutated value and treat a `stream: false` client request as if
    // the caller wanted SSE — the SDK on the other end would then
    // fail to parse the SSE body as JSON.
    const clientAskedStream = inv.body.stream === true
    const upstream = await runPipeline(
      {
        body: inv.body,
        headers: inv.headers,
        provider: inv.provider,
        transformer: inv.transformer,
        context: { req: inv.request }
      },
      { log: ctx.log, httpsProxy: ctx.config.getHttpsProxy(), recordUsage, recordMessages }
    )
    return formatResponse(c, upstream, clientAskedStream, ctx.log, {
      provider: inv.provider.name,
      model: inv.request.model,
      path: plan.path
    })
  }

  // Inbound path determines which error envelope OpenAI / Anthropic
  // clients get back — /v1/chat/completions gets `{error:{message,type,code}}`
  // even when the upstream returned codex's `{detail}`.
  const inboundShape = errorShapeForPath(plan.path)

  // One model attempt with the effort-level retry folded in: if the
  // upstream 400 told us which effort levels it supports, swap and retry
  // once against the SAME model before bubbling the error up to the
  // failover loop.
  const attempt = async (inv: ResolvedInvocation): Promise<Response> => {
    try {
      return await runWith(inv)
    } catch (err) {
      if (forwardUpstreamError(err, inboundShape)) {
        const message = err instanceof HTTPException ? err.message : ''
        const fix = bestSupportedLevel(message)
        if (fix && deepReplaceValue(inv.body, fix.bad, fix.level)) {
          return await runWith(inv)
        }
      }
      throw err
    }
  }

  const chainCtx: ChainCtx = { c, ctx, plan, providers, sessionId, attempt, errorResponse }
  let lastForwarded: Response | null = null
  for (const model of chain) {
    const outcome = await attemptChainEntry(chainCtx, model)
    if (outcome.kind === 'done') return outcome.response
    if (outcome.forwarded !== null) lastForwarded = outcome.forwarded
  }

  // Chain exhausted: every candidate was rate-limited (or unresolvable).
  if (lastForwarded) return lastForwarded
  return c.json({ type: 'error', error: { type: 'invalid_request', message: 'No usable model for this request' } }, 400)
}

// Route mounts come from the registry, one per surface — including
// `/v1beta/models/:modelAndAction`, which no `/v1/*` pattern can reach.
for (const surface of INBOUND_SURFACES) v1Route.post(surface.endpoint, handleInbound)

// Not a surface: the fail-closed lane for an unknown /v1 path, which has
// to answer 404 in the caller's own envelope rather than fall through to
// the SPA catch-all. Registered last so a surface's own mount wins.
v1Route.post('/v1/*', handleInbound)
