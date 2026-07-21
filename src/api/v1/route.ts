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
import { getLlmsContext, type MessageRecord, runPipeline, type UsageRecord } from '../../llms'
import { requestLogEmitter } from '../request-logs/events'
import { attemptChainEntry, type ChainCtx, type SubscriptionKindProvider, sessionIdFrom } from './chain-failover'
import { buildFailoverChain, buildRoutePlan, type ResolvedInvocation } from './invocation'
import { bestSupportedLevel, deepReplaceValue, forwardUpstreamError } from './upstream-error'

export const v1Route = new Hono()

// ─── Usage capture sink ─────────────────────────────────────────────────

async function recordUsage(entry: UsageRecord): Promise<void> {
  const prisma = getPrismaClient()
  // New activity un-archives a previously archived session so it returns to
  // the History list (archivedAt: null), while still bumping updatedAt.
  await prisma.session.upsert({
    where: { id: entry.sessionId },
    create: { id: entry.sessionId },
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
  if (entries.length === 0) return
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
    data: entries.map((e) => ({ sessionId: e.sessionId, role: e.role, content: e.content as never }))
  })
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

function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof HTTPException) {
    return c.json({ type: 'error', error: { type: 'internal_error', message: err.message } }, err.status as 500)
  }
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ type: 'error', error: { type: 'internal_error', message } }, 500)
}

// ─── Handler ────────────────────────────────────────────────────────────

v1Route.post('/v1/*', async (c) => {
  const ctx = await getLlmsContext()
  const planOrResponse = await buildRoutePlan(c, ctx)
  if (planOrResponse instanceof Response) return planOrResponse
  const plan = planOrResponse

  const chain = buildFailoverChain(plan, ctx)
  const providers = ctx.config.get<SubscriptionKindProvider[]>('providers', [])
  const sessionId = sessionIdFrom(plan.headers)

  const runWith = async (inv: ResolvedInvocation): Promise<Response> => {
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
})
