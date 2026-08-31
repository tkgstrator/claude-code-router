/**
 * Per-request invocation assembly for the /v1 LLM proxy.
 *
 * `buildRoutePlan` parses the inbound request once, runs scenario
 * routing to land on a primary "provider,model", and bundles everything
 * the chain walker needs for the lifetime of this request. Each
 * fallback model the walker considers then flows through
 * `resolveInvocationForModel`, which produces a ready-to-run
 * `ResolvedInvocation` (body + headers + provider + transformer) with
 * per-model shaping applied — effort clamping, CCR-internal field strip,
 * subscription beta-header reshape — without ever mutating the route
 * plan itself.
 */

import type { Context } from 'hono'
import '../context'
import { type PipelineRequest, type Provider, RecordSchema } from '@/schemas'
import {
  type LlmsContext,
  type ResolvedProvider,
  type RouterRequest,
  routeScenario,
  type ScenarioType,
  type Transformer
} from '../../llms'
import { inboundTypeForPath, surfaceForPath } from '../../llms/inbound/surfaces'
import { isLongContextDenied, isModelExhausted } from '../../services/failover-state'
import { getActiveAccountForSession } from '../../services/session-account-router'
import { buildErrorEnvelope, errorShapeForPath } from './error-shape'
import { prepareSubscriptionBetas } from './subscription-betas'

// ─── Reasoning-effort normalisation ────────────────────────────────────

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

// Resolve whether the target this request is about to hit has already
// been refused the long-context entitlement. The sticky session→account
// map is consulted so the answer is account-scoped whenever the pipeline
// has picked one; without a session header it falls back to the coarser
// provider-level mark.
function longContextDeniedFor(headers: Record<string, string>, providerName: string): boolean {
  const sessionId = headers['x-claude-code-session-id']
  const account = typeof sessionId === 'string' && sessionId.length > 0 ? getActiveAccountForSession(sessionId) : null
  return isLongContextDenied(providerName, account)
}

// ─── Endpoint transformer index ────────────────────────────────────────

function endpointTransformerMap(ctx: LlmsContext): Map<string, Map<string, Transformer>> {
  const map = new Map<string, Map<string, Transformer>>()
  for (const { name, transformer } of ctx.transformers.getWithEndpoint()) {
    const ep = transformer.endPoint!
    if (!map.has(ep)) map.set(ep, new Map())
    map.get(ep)!.set(name, transformer)
  }
  return map
}

// ─── Route plan + resolved invocation shapes ───────────────────────────

// Resolved once per inbound request, before any model is picked off the
// failover chain. routeScenario has run, so `primaryModel` is the
// "provider,model" it landed on and `scenarioType` selects the matching
// fallback chain. `routedBody` is the post-routeScenario body BEFORE
// per-model shaping (effort clamp, internal-field strip) so every chain
// attempt re-derives those from a clean copy.
export interface RoutePlan {
  routedBody: Record<string, unknown>
  headers: Record<string, string>
  transformersByName: Map<string, Transformer>
  defaultTransformer: Transformer
  scenarioType: ScenarioType
  primaryModel: string
  // The client's original body.model (pre-routing), carried through to the
  // usage-capture step so every request_logs row records "what was asked
  // for" next to "what was actually sent". Absent when the body had no
  // usable model string.
  requestedModel?: string
  // Whether the request carried a <CCR-SUBAGENT-MODEL> tag. Selects the
  // scenario's subagent route (vs agent) for the reactive failover chain,
  // so it matches the route selectModel used for the primary.
  isSubagent: boolean
  // Pre-resolved fallback chain: either a rule's own fallbacks (when a
  // route rule matched inside selectModel) or the scenario's catch-all
  // chain. buildFailoverChain reads this rather than re-looking-up so
  // the reactive path walks the same chain the proactive path did.
  fallbacks: readonly string[]
  // Subset of `fallbacks` auto-injected by the cross-provider peer
  // expander. buildFailoverChain reads this to bypass the same-auth_mode
  // gate on peer entries — the user opted into cross-auth-mode failover
  // when they enabled CROSS_PROVIDER_FALLBACK. Empty when the toggle
  // is off or no peers were injected.
  peerTargets: ReadonlySet<string>
  path: string
  search: string
  // The AccessToken that authenticated this request, when one did.
  // Recorded on RequestLog so Activity can attribute spend to a client.
  accessTokenId?: string
}

// A single model's fully-resolved invocation, ready for the pipeline.
export interface ResolvedInvocation {
  body: Record<string, unknown>
  headers: Record<string, string>
  request: PipelineRequest
  provider: ResolvedProvider
  transformer: Transformer
}

// ─── Build path ────────────────────────────────────────────────────────

export async function buildRoutePlan(c: Context, ctx: LlmsContext): Promise<Response | RoutePlan> {
  const url = new URL(c.req.url)
  const path = url.pathname
  const shape = errorShapeForPath(path)

  const transformersByName = endpointTransformerMap(ctx).get(path)
  if (!transformersByName) {
    return c.json(buildErrorEnvelope({ shape, status: 404, from: `No handler for ${path}` }), 404)
  }
  // First registered transformer at this endpoint; resolveInvocationForModel
  // may swap it per-model if the routed-to provider has a bypass single-use.
  const defaultTransformer: Transformer = transformersByName.values().next().value!

  // Set by the /v1 auth middleware when an issued token authenticated
  // the call. Absent for the envelope bootstrap token.
  const token = c.get('accessToken')
  const tokenId = token?.id

  const bodyParsed = RecordSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!bodyParsed.success) {
    return c.json(buildErrorEnvelope({ shape, status: 400, from: 'Request body must be a JSON object' }), 400)
  }
  const body = bodyParsed.data
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => {
    headers[k] = v
  })

  // Capture what the client asked for BEFORE routeScenario rewrites
  // body.model in place — this is the only point the original is visible.
  const requestedModel = typeof body.model === 'string' && body.model.length > 0 ? body.model : undefined

  // Scenario routing: rewrite body.model to the resolved provider,model
  // and stamp req.scenarioType. We keep the request object so we can read
  // the scenario back — it selects the failover chain below.
  const routeReq: RouterRequest = {
    body: body as PipelineRequest['body'] & { model: string },
    log: ctx.log,
    sessionId: undefined,
    // The scenario router uses this to gate Anthropic-idiom mutations
    // (persona injection etc.) so OpenAI-compat callers on
    // /v1/chat/completions and /v1/responses get the exact request
    // they sent rather than one enriched for Claude Code.
    inboundPath: path,
    // A token may pin its client to a named preference chain, which
    // then wins over the surface's own profile. This is the point of
    // per-client tokens: a CI runner on cost-first while interactive
    // traffic keeps the default.
    profileKeyOverride: token?.profileKey === null ? undefined : token?.profileKey
  }
  await routeScenario(routeReq, { config: ctx.config, tokenizers: ctx.tokenizers })
  const scenarioType: ScenarioType = routeReq.scenarioType !== undefined ? routeReq.scenarioType : 'default'

  // Phase 4: quota-aware selector exhausted all candidates and the
  // profile's `exhaustedBehavior` is '429'. Return the rate-limit
  // response verbatim so no upstream dispatch happens. `Retry-After`
  // carries the seconds until the earliest binding-window reset.
  const retryAfter = routeReq.quotaExhaustedRetryAfterSec
  if (typeof retryAfter === 'number' && retryAfter > 0) {
    return new Response(
      JSON.stringify(
        buildErrorEnvelope({
          shape,
          status: 429,
          from: 'Preference chain exhausted; retry after the window resets.'
        })
      ),
      {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': String(retryAfter) }
      }
    )
  }

  const primaryModel = typeof body.model === 'string' ? body.model : ''
  if (primaryModel.length === 0) {
    return c.json(buildErrorEnvelope({ shape, status: 400, from: 'Missing model in request body' }), 400)
  }

  return {
    routedBody: body,
    headers,
    transformersByName,
    defaultTransformer,
    scenarioType,
    primaryModel,
    requestedModel,
    isSubagent: routeReq.isSubagent === true,
    // The fallback chain selectModel resolved for this request — a rule's
    // own chain when a route rule fired, otherwise the scenario's
    // catch-all. buildFailoverChain reads this directly so the reactive
    // path walks the same chain the proactive path did.
    fallbacks: Array.isArray(routeReq.resolvedFallbacks) ? routeReq.resolvedFallbacks : [],
    peerTargets: routeReq.resolvedPeerTargets ?? new Set<string>(),
    path,
    search: url.search,
    accessTokenId: tokenId
  }
}

// Resolve a bare model name (no "provider," prefix) by scanning the
// provider registry for a provider that lists this model. Returns the
// provider name on a unique match, null when the model is unknown, or
// null with a warning when multiple providers host it (ambiguous —
// can't pick without operator intent). Callers use this to pass a
// bare-model request through to the sole hosting provider when the
// scenario router had no primary configured for the request.
function providerHostingModel(ctx: LlmsContext, bareModel: string): string | null {
  const hosts: string[] = []
  for (const p of ctx.providers.getAll()) {
    if (Array.isArray(p.models) && p.models.includes(bareModel)) hosts.push(p.name)
  }
  if (hosts.length === 0) return null
  if (hosts.length > 1) {
    ctx.log.warn({ model: bareModel, hosts }, 'passthrough: bare model is ambiguous across providers; skipping')
    return null
  }
  return hosts[0]
}

// Resolve one "provider,model" string into a ready-to-run invocation, or
// null when the model can't be used (malformed string / unknown
// provider) — the caller skips a null and moves to the next chain entry.
export function resolveInvocationForModel(
  plan: RoutePlan,
  modelString: string,
  ctx: LlmsContext
): ResolvedInvocation | null {
  let providerName: string | undefined
  let model: string
  const commaIdx = modelString.indexOf(',')
  if (commaIdx > 0) {
    providerName = modelString.slice(0, commaIdx)
    model = modelString.slice(commaIdx + 1)
  } else {
    // Bare model (no "provider," prefix): the scenario router had no
    // primary configured and left `req.body.model` untouched, so the
    // failover chain contains just the raw model name the client asked
    // for. Look it up in the provider registry — a unique host acts as
    // the pass-through target; ambiguous / unknown models still fall
    // through to the malformed-input branch below.
    const host = providerHostingModel(ctx, modelString)
    if (host !== null) {
      providerName = host
      model = modelString
      ctx.log.info({ model, provider: providerName }, 'passthrough: bare model resolved to provider')
    } else {
      model = ''
    }
  }
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
  // Reshape the anthropic-beta header (add oauth beta; drop context-1m
  // only when this provider/account is known to lack the entitlement).
  if (typeof soleUseName === 'string' && soleUseName.endsWith('-oauth')) {
    prepareSubscriptionBetas(headers, longContextDeniedFor(headers, providerName))
  }

  const request: PipelineRequest = {
    body,
    headers,
    url: plan.path + plan.search,
    provider: providerName,
    model,
    scenarioType: plan.scenarioType,
    requestedModel: plan.requestedModel,
    isSubagent: plan.isSubagent,
    inboundType: inboundTypeForSurface(plan.path),
    surface: surfaceForPath(plan.path)?.id,
    accessTokenId: plan.accessTokenId
  }

  return { body, headers, request, provider, transformer }
}

const providerNameOf = (modelString: string): string => modelString.split(',')[0]
const modelNameOf = (modelString: string): string => modelString.split(',').slice(1).join(',')

// Persisted wire-type slug for a /v1 inbound path, from the surface
// registry. Unknown paths (never expected here, but the route helper is
// generic) return undefined so RequestLog / Session stay null instead of
// being falsely bucketed.
//
// `PipelineRequest.inboundType` predates the gemini surface and is still
// the two-value column the History filter reads, so a gemini request
// records its wire type through `surface` alone until that column is
// widened.
function inboundTypeForSurface(path: string): 'anthropic' | 'openai' | undefined {
  const inbound = inboundTypeForPath(path)
  return inbound === 'gemini' ? undefined : inbound
}

// Ordered list of "provider,model" candidates for this request: the
// resolved primary first, then the pre-computed fallback chain. Skips
// candidates currently known to be rate-limited (by model or by
// provider), but never returns empty — if every candidate is exhausted
// we still try them (the window may have reset since we marked it).
//
// One filter gate remains on the fallback list:
//
//   auth_mode gate: when the primary is a subscription provider,
//   fallbacks are constrained to other subscription providers — a 429
//   on the user's "free seat" must not silently roll onto an api_key
//   provider that costs per-token.
//
// The same-provider gate that used to sit here has been removed: quota
// exhaustion is now tracked per (provider, model), so a different
// model on the same provider (Fable → Opus on the same Anthropic
// account, whose 5h/weekly windows are per-model) is a legitimate
// fallback target.
export function buildFailoverChain(plan: RoutePlan, ctx: LlmsContext): string[] {
  const fallbacks = plan.fallbacks

  const providers = ctx.config.get<Provider[]>('providers', [])
  const authModeByName = new Map(providers.map((p) => [p.name, p.auth_mode]))
  const primaryName = providerNameOf(plan.primaryModel)
  const primaryAuth = authModeByName.get(primaryName)

  const seen = new Set<string>()
  const ordered = [plan.primaryModel, ...fallbacks].filter((m) => {
    if (seen.has(m)) return false
    seen.add(m)
    if (m === plan.primaryModel) return true
    // Peer entries auto-injected by the cross-provider expander skip the
    // auth_mode gate: the user opted into cross-auth-mode failover when
    // they enabled CROSS_PROVIDER_FALLBACK, so a subscription primary
    // may hop to an api_key peer of the same model. Explicit fallbacks
    // still respect the gate below.
    if (plan.peerTargets.has(m)) return true
    const name = providerNameOf(m)
    // Same-mode fallbacks only when primary auth_mode is known.
    // Unknown-auth providers (e.g. typo'd fallback entries) pass through
    // and surface their own "provider not found" warn downstream.
    const auth = authModeByName.get(name)
    if (primaryAuth !== undefined && auth !== undefined && auth !== primaryAuth) return false
    return true
  })

  const live = ordered.filter((m) => !isModelExhausted(providerNameOf(m), modelNameOf(m)))
  return live.length > 0 ? live : ordered
}
