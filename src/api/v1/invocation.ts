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
import { type PipelineRequest, type Provider, RecordSchema } from '@/schemas'
import {
  type LlmsContext,
  type ResolvedProvider,
  type RouterRequest,
  routeScenario,
  type ScenarioType,
  type Transformer
} from '../../llms'
import { isModelExhausted } from '../../services/failover-state'

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
  path: string
  search: string
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

  // Capture what the client asked for BEFORE routeScenario rewrites
  // body.model in place — this is the only point the original is visible.
  const requestedModel = typeof body.model === 'string' && body.model.length > 0 ? body.model : undefined

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
    requestedModel,
    isSubagent: routeReq.isSubagent === true,
    // The fallback chain selectModel resolved for this request — a rule's
    // own chain when a route rule fired, otherwise the scenario's
    // catch-all. buildFailoverChain reads this directly so the reactive
    // path walks the same chain the proactive path did.
    fallbacks: Array.isArray(routeReq.resolvedFallbacks) ? routeReq.resolvedFallbacks : [],
    path,
    search: url.search
  }
}

// Resolve one "provider,model" string into a ready-to-run invocation, or
// null when the model can't be used (malformed string / unknown
// provider) — the caller skips a null and moves to the next chain entry.
export function resolveInvocationForModel(
  plan: RoutePlan,
  modelString: string,
  ctx: LlmsContext
): ResolvedInvocation | null {
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
    scenarioType: plan.scenarioType,
    requestedModel: plan.requestedModel,
    isSubagent: plan.isSubagent
  }

  return { body, headers, request, provider, transformer }
}

const providerNameOf = (modelString: string): string => modelString.split(',')[0]
const modelNameOf = (modelString: string): string => modelString.split(',').slice(1).join(',')

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
