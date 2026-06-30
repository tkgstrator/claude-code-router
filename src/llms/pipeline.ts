/**
 * Request pipeline.
 *
 * Replaces vendor/api/routes.ts `handleTransformerEndpoint`. The Hono
 * /v1 adapter (src/api/v1/route.ts) resolves the endpoint transformer
 * by path and the routed-to provider/model, then hands both to this
 * function. The pipeline:
 *
 *   1. runs the endpoint transformer's `transformRequestOut` (wire →
 *      unified shape), unless bypass mode applies,
 *   2. runs the provider's `transformer.use` chain (each
 *      `transformRequestIn`),
 *   3. runs any model-specific `transformer[model].use` chain,
 *   4. calls the endpoint transformer's `auth` hook in bypass mode,
 *   5. POSTs the unified request to the provider,
 *   6. runs the response chain in reverse,
 *   7. runs the endpoint transformer's `transformResponseIn`,
 *   8. returns the upstream `Response` to the adapter for SSE/JSON
 *      relay.
 *
 * Errors are surfaced as Hono HTTPException; the v1 adapter forwards
 * the upstream body verbatim so Claude Code can react to genuine
 * rate-limit / billing errors.
 */

import { randomUUID } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import type { Logger } from 'pino'
import {
  AnthropicMessageDeltaEventSchema,
  AnthropicMessageStartEventSchema,
  ChatCompletionUsageChunkSchema,
  isProviderModelBlock,
  isTransformerHookResult,
  JsonResponseWithUsageSchema,
  type PipelineBodyView,
  ResponsesCompletedEventSchema,
  type TransformerConfig,
  type TransformerContext,
  type TransformerHookResult,
  type UnifiedChatRequest,
  type UsageBlock,
  type UsageRecord,
  viewPipelineBody
} from '@/schemas'
import { fetchProvider } from './provider-fetch'
import type { ResolvedProvider, ResolvedProviderTransformer } from './registry/provider'
import type { Transformer } from './transformers/base'

export type PipelineDeps = {
  log: Logger
  /** Outbound HTTPS proxy URL, if any. */
  httpsProxy?: string
  /** Hook to write a usage row to the request_logs table (best-effort). */
  recordUsage?: (entry: UsageRecord) => Promise<void>
}

export type { UsageRecord } from '@/schemas'

export type PipelineInput = {
  /** Raw inbound request body. */
  body: Record<string, unknown>
  /** Inbound headers (case-preserved as the upstream client sent them). */
  headers: Record<string, string>
  /** Resolved provider for this request. */
  provider: ResolvedProvider
  /** Endpoint transformer the v1 adapter dispatched against. */
  transformer: Transformer
  /** Transformer-side context shared with hooks (must carry `req` for
   *  session-id sniffing and log correlation). */
  context: TransformerContext
}

/**
 * Run the pipeline and return the upstream Response. The caller is
 * responsible for formatting it back to the inbound client (JSON vs
 * SSE, status code, headers).
 */
export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<Response> {
  const { provider, transformer } = input

  const bypass = shouldBypass(provider.transformer, transformer, input.body)
  const { requestBody, config } = await processRequestTransformers(input, bypass)
  return sendToProvider(requestBody, config, provider, transformer, bypass, input.context, deps).then((response) =>
    processResponseTransformers(requestBody, response, provider, transformer, bypass, input.context)
  )
}

// ─── Bypass detection ───────────────────────────────────────────────────

function shouldBypass(
  providerTx: ResolvedProviderTransformer | undefined,
  transformer: Transformer,
  body: Record<string, unknown>
): boolean {
  const topUse = providerTx?.use
  if (!Array.isArray(topUse) || topUse.length !== 1 || topUse[0].name !== transformer.name) return false
  const modelBlock = lookupProviderModelBlock(providerTx, typeof body.model === 'string' ? body.model : '')
  const modelUse = modelBlock?.use
  if (!modelUse || modelUse.length === 0) return true
  return modelUse.length === 1 && modelUse[0].name === transformer.name
}

/**
 * Resolve the per-model entry on `provider.transformer[modelKey]`. The
 * registry stores arbitrary value kinds at this key (Transformer[],
 * subscription metadata, ...); the type guard isolates the
 * `{ use?: Transformer[] }` shape callers actually want.
 */
function lookupProviderModelBlock(
  providerTx: ResolvedProviderTransformer | undefined,
  modelKey: string | undefined
): { use?: Transformer[] } | undefined {
  if (!providerTx || modelKey === undefined || modelKey.length === 0) return undefined
  const raw = providerTx[modelKey]
  if (!isProviderModelBlock(raw)) return undefined
  // Narrow the shape: ProviderModelBlock allows `use?: unknown[]`; the
  // registry stores Transformer instances there (resolveUseList builds
  // Transformer[]), so the runtime invariant holds.
  const use = raw.use
  if (use === undefined) return {}
  return { use: filterTransformerInstances(use) }
}

/**
 * Filter an `unknown[]` from the registry shape down to the Transformer
 * instances actually stored there. Defensive — the registry always
 * inserts Transformer instances on the per-model `use` slot — but
 * structural typing requires us to narrow before invoking the methods.
 */
function filterTransformerInstances(values: readonly unknown[]): Transformer[] {
  const out: Transformer[] = []
  for (const v of values) {
    if (isTransformerInstance(v)) out.push(v)
  }
  return out
}

function isTransformerInstance(value: unknown): value is Transformer {
  if (value === null || typeof value !== 'object') return false
  if (!('name' in value) || !('transformRequestIn' in value)) return false
  const name: unknown = Reflect.get(value, 'name')
  const fn: unknown = Reflect.get(value, 'transformRequestIn')
  return typeof name === 'string' && typeof fn === 'function'
}

// ─── Request chain ──────────────────────────────────────────────────────

async function processRequestTransformers(
  input: PipelineInput,
  bypass: boolean
): Promise<{ requestBody: unknown; config: TransformerConfig }> {
  let requestBody: unknown = input.body
  let config: TransformerConfig = {}

  if (bypass) {
    // Strip hop-by-hop and client-negotiation headers that must not be
    // forwarded to the upstream provider:
    //  - content-length: the body will be re-serialised by fetchProvider
    //  - accept-encoding: CCR's fetch handles its own decompression; passing
    //    the inbound value causes the upstream to return a compressed body
    //    that Bun auto-decompresses, but the content-encoding header lingers
    //    in the response and triggers a double-decompress ZlibError on the
    //    Claude Code client side.
    const headers: Record<string, string | undefined> = { ...input.headers }
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'content-length' || lower === 'accept-encoding') delete headers[key]
    }
    config = { headers }
    return { requestBody, config }
  }

  // 1. Endpoint transformer's transformRequestOut (wire → unified).
  const transformed = await input.transformer.transformRequestOut(requestBody, input.context)
  requestBody = transformed

  // 2. Provider-level transformer chain.
  const providerTx = input.provider.transformer
  const use = Array.isArray(providerTx?.use) ? providerTx.use : []
  for (const step of use) {
    const result = await step.transformRequestIn(asUnifiedRequest(requestBody), input.provider, input.context)
    ;({ requestBody, config } = mergeHookResult(result, requestBody, config))
  }

  // 3. Model-specific chain.
  const view = viewPipelineBody(requestBody)
  const modelBlock = lookupProviderModelBlock(providerTx, view.model)
  const modelUse = modelBlock?.use
  if (modelUse) {
    for (const step of modelUse) {
      const result = await step.transformRequestIn(asUnifiedRequest(requestBody), input.provider, input.context)
      ;({ requestBody, config } = mergeHookResult(result, requestBody, config))
    }
  }

  return { requestBody, config }
}

/**
 * The pipeline carries the in-flight body as `unknown` because every
 * transformer reshapes it differently. transformRequestIn expects a
 * UnifiedChatRequest; this helper is the documented unsafe-narrowing
 * boundary between the loose pipeline state and the strict hook input.
 */
function asUnifiedRequest(body: unknown): UnifiedChatRequest {
  // biome-ignore plugin: pipeline state is unknown by design (every transformer reshapes the body);
  // UnifiedChatRequest is what each hook expects on entry. The cast is the documented boundary.
  return body as UnifiedChatRequest
}

function mergeHookResult(
  result: unknown,
  prevBody: unknown,
  prevConfig: TransformerConfig
): { requestBody: unknown; config: TransformerConfig } {
  if (isTransformerHookResult(result)) {
    const hookConfig: TransformerConfig = result.config !== undefined ? result.config : {}
    return {
      requestBody: result.body,
      config: { ...prevConfig, ...hookConfig }
    }
  }
  // Plain replacement body — fall back to the previous body only when
  // the hook returned no value at all.
  return { requestBody: result === undefined ? prevBody : result, config: prevConfig }
}

// ─── Send to provider ───────────────────────────────────────────────────

async function sendToProvider(
  requestBody: unknown,
  config: TransformerConfig,
  provider: ResolvedProvider,
  transformer: Transformer,
  bypass: boolean,
  context: TransformerContext,
  deps: PipelineDeps
): Promise<Response> {
  const { body, outConfig } = await applyBypassAuth(requestBody, config, provider, transformer, bypass, context)
  const url = outConfig.url !== undefined ? outConfig.url : new URL(provider.api_base_url)

  // One id per upstream send. LogViewer groups a request's lines by
  // reqId — bind it on a child logger so request body / response /
  // error all carry the same id.
  const reqId = randomUUID()
  const reqLog = deps.log.child({ reqId })
  const startedAt = Date.now()

  const headers = buildRequestHeaders(provider, outConfig)

  logRequest(reqLog, provider, body, url, bypass)

  const response = await fetchProvider(url, body, { headers, httpsProxy: deps.httpsProxy }, { reqId }, reqLog)
  const durationMs = Date.now() - startedAt

  if (!response.ok) {
    await handleProviderError(response, provider, transformer, body, durationMs, reqLog)
  }

  logResponse(reqLog, provider, body, response.status, durationMs)

  // Best-effort usage capture from a cloned stream so the completion
  // log carries token + cache stats. Never blocks the response.
  if (deps.recordUsage && typeof response.clone === 'function') {
    const clone = response.clone()
    void captureUsage(clone, context, provider, body, response.status, durationMs, deps).catch(() => {})
  }

  return response
}

/**
 * Bypass-mode auth hook (subscription OAuth flows live here). When the
 * hook returns `{ body, config }`, merge upstream headers in case-safe
 * order; otherwise the hook may return a plain body replacement.
 */
async function applyBypassAuth(
  body: unknown,
  config: TransformerConfig,
  provider: ResolvedProvider,
  transformer: Transformer,
  bypass: boolean,
  context: TransformerContext
): Promise<{ body: unknown; outConfig: TransformerConfig }> {
  if (!bypass) return { body, outConfig: config }

  const auth = await transformer.auth(body, provider, context)
  if (!isTransformerHookResult(auth)) {
    return { body: auth, outConfig: config }
  }

  const inboundHeaders: Record<string, string | undefined> = config.headers !== undefined ? { ...config.headers } : {}
  if (auth.config?.headers) {
    // Drop every case variant of inbound auth headers before merging
    // the transformer's upstream auth — otherwise inbound lowercase
    // `authorization` lingers and Headers.set() (case-insensitive)
    // can pick the wrong value.
    for (const k of Object.keys(inboundHeaders)) {
      const lower = k.toLowerCase()
      if (lower === 'authorization' || lower === 'x-api-key') delete inboundHeaders[k]
    }
    Object.assign(inboundHeaders, auth.config.headers)
    delete inboundHeaders.host
  }
  return { body: auth.body, outConfig: { ...config, ...auth.config, headers: inboundHeaders } }
}

function buildRequestHeaders(
  provider: ResolvedProvider,
  outConfig: TransformerConfig
): Record<string, string | undefined> {
  // Build header set: provider Bearer (overwritten by transformer auth
  // headers, if any), then merge transformer-provided headers.
  const merged: Record<string, string | undefined> = {
    Authorization: `Bearer ${provider.api_key}`,
    ...(outConfig.headers !== undefined ? outConfig.headers : {})
  }
  for (const k of Object.keys(merged)) {
    const v = merged[k]
    if (v === 'undefined') delete merged[k]
    else if (k.toLowerCase() === 'authorization' && typeof v === 'string' && v.includes('undefined')) delete merged[k]
  }
  return merged
}

function logRequest(log: Logger, provider: ResolvedProvider, body: unknown, url: URL | string, bypass: boolean): void {
  const view = viewPipelineBody(body)
  log.debug(
    {
      type: 'request body',
      data: {
        provider: provider.name,
        model: view.model,
        url: String(url),
        stream: view.stream === true,
        bypass,
        messages: view.messages !== undefined ? view.messages.length : undefined,
        tools: view.tools !== undefined ? view.tools.length : undefined
      }
    },
    'llm request'
  )
}

// Parse upstream error bodies so pino logs them as nested objects
// instead of an escape-laden string. Anything that isn't valid JSON
// (HTML error pages, plain text) is returned verbatim so the raw bytes
// still reach the log.
function tryParseJson(text: string): unknown {
  if (text.length === 0) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function logResponse(log: Logger, provider: ResolvedProvider, body: unknown, status: number, durationMs: number): void {
  const view = viewPipelineBody(body)
  log.debug(
    {
      type: 'response',
      provider: provider.name,
      model: view.model,
      status,
      durationMs
    },
    `${provider.name}/${view.model} ${status} ${durationMs}ms`
  )
}

async function handleProviderError(
  response: Response,
  provider: ResolvedProvider,
  transformer: Transformer,
  body: unknown,
  durationMs: number,
  log: Logger
): Promise<never> {
  const errorText = await response.text()
  const isSubscription = transformer.name.endsWith('-oauth')
  const view = viewPipelineBody(body)
  const model = view.model !== undefined ? view.model : 'unknown'

  // KEEP this message byte-for-byte: v1/route.ts has a regex
  // (PROVIDER_ERR_RE) that parses "Error from provider(<name>,<model>:
  // <status>): <rawBody>" to forward the genuine upstream error to
  // Claude Code verbatim.
  const message = `Error from provider(${provider.name},${model}: ${response.status}): ${errorText}`
  log.error(
    {
      type: 'response',
      provider: provider.name,
      model,
      status: response.status,
      durationMs,
      body: tryParseJson(errorText)
    },
    `[provider_response_error] ${message}`
  )

  if ((response.status === 401 || response.status === 403) && isSubscription) {
    log.error(
      { provider: provider.name, status: response.status },
      `Subscription auth rejected by '${provider.name}' (${response.status}). ` +
        'If the OAuth credentials are absent/expired, re-authenticate ' +
        'the underlying CLI (run `claude` and sign in for claude-code, ' +
        'or `codex login` for codex) to refresh the credentials file.'
    )
  }
  // biome-ignore plugin: HTTPException's status param is typed as a closed union of supported codes;
  // upstream returns arbitrary HTTP codes which we forward verbatim, so the cast is the only path.
  throw new HTTPException(response.status as never, { message })
}

// ─── Response chain ─────────────────────────────────────────────────────

async function processResponseTransformers(
  requestBody: unknown,
  response: Response,
  provider: ResolvedProvider,
  transformer: Transformer,
  bypass: boolean,
  context: TransformerContext
): Promise<Response> {
  if (bypass) return response

  let finalResponse = response

  // Provider-level response chain (reverse order from request chain).
  const providerTx = provider.transformer
  const providerUse = Array.isArray(providerTx?.use) ? [...providerTx.use].reverse() : []
  for (const step of providerUse) {
    finalResponse = await step.transformResponseOut(finalResponse, context)
  }

  // Model-specific response chain (also reversed).
  const view = viewPipelineBody(requestBody)
  const modelBlock = lookupProviderModelBlock(providerTx, view.model)
  const reverseModelUse = modelBlock?.use ? [...modelBlock.use].reverse() : []
  for (const step of reverseModelUse) {
    finalResponse = await step.transformResponseOut(finalResponse, context)
  }

  // Endpoint transformer's final shaping pass.
  return transformer.transformResponseIn(finalResponse, context)
}

// ─── Usage extraction ───────────────────────────────────────────────────

async function captureUsage(
  resp: Response,
  context: TransformerContext,
  provider: ResolvedProvider,
  body: unknown,
  status: number,
  durationMs: number,
  deps: PipelineDeps
): Promise<void> {
  const usage = await extractUsage(resp)
  if (!usage) return

  const sessionId = resolveSessionId(context)
  const tokens = computeTokenStats(usage)
  const view = viewPipelineBody(body)

  await deps.recordUsage?.({
    sessionId,
    provider: provider.name,
    model: view.model !== undefined ? view.model : 'unknown',
    inputTokens: tokens.rawInput,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cachedTokens,
    cacheWriteTokens: tokens.writtenTokens,
    totalInputTokens: tokens.totalInputTokens,
    cacheHitPct: tokens.cacheHitPct,
    durationMs,
    status
  })
}

function resolveSessionId(context: TransformerContext): string {
  const headers = context.req?.headers !== undefined ? context.req.headers : {}
  const threadId = typeof headers.thread_id === 'string' ? headers.thread_id : undefined
  if (threadId) return threadId
  const ccSession =
    typeof headers['x-claude-code-session-id'] === 'string' ? headers['x-claude-code-session-id'] : undefined
  if (ccSession) return ccSession
  return randomUUID()
}

type TokenStats = {
  cachedTokens: number
  writtenTokens: number
  outputTokens: number
  rawInput: number
  totalInputTokens: number
  cacheHitPct: number
}

function computeTokenStats(usage: UsageBlock): TokenStats {
  const cachedTokens =
    numberOrZero(usage.cache_read_input_tokens) || numberOrZero(usage.input_tokens_details?.cached_tokens)
  const writtenTokens = numberOrZero(usage.cache_creation_input_tokens)
  const outputTokens = numberOrZero(usage.output_tokens) || numberOrZero(usage.completion_tokens)
  // Anthropic input_tokens is the non-cached portion only; OpenAI uses prompt_tokens.
  const rawInput = numberOrZero(usage.input_tokens) || numberOrZero(usage.prompt_tokens)
  const totalInputTokens = rawInput + writtenTokens + cachedTokens
  const cacheHitPct = totalInputTokens > 0 ? Math.round((cachedTokens / totalInputTokens) * 100) : 0
  return { cachedTokens, writtenTokens, outputTokens, rawInput, totalInputTokens, cacheHitPct }
}

/** Coerce an optional `unknown` numeric usage field to a finite number, defaulting to 0. */
function numberOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function extractUsage(resp: Response): Promise<UsageBlock | null> {
  try {
    const ct = resp.headers.get('content-type')
    const contentType = (typeof ct === 'string' ? ct : '').toLowerCase()
    if (contentType.includes('application/json')) {
      return await extractJsonUsage(resp)
    }
    // SSE or unknown content type — parse line-by-line.
    return await extractStreamUsage(resp)
  } catch {
    return null
  }
}

async function extractJsonUsage(resp: Response): Promise<UsageBlock | null> {
  const json = await resp.json().catch(() => null)
  const result = JsonResponseWithUsageSchema.safeParse(json)
  if (!result.success) return null
  return result.data.usage !== undefined ? result.data.usage : null
}

async function extractStreamUsage(resp: Response): Promise<UsageBlock | null> {
  const text = await resp.text()
  let usage: UsageBlock | null = null
  for (const block of text.split('\n\n')) {
    usage = applySseBlock(block, usage)
  }
  if (!usage) usage = fallbackJsonParse(text)
  return usage
}

function applySseBlock(block: string, current: UsageBlock | null): UsageBlock | null {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return current
  const raw = dataLine.slice(5).trim()
  if (raw === '[DONE]') return current
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return current
  }

  const start = AnthropicMessageStartEventSchema.safeParse(obj)
  if (start.success) return { ...start.data.message.usage }

  const delta = AnthropicMessageDeltaEventSchema.safeParse(obj)
  if (delta.success) return { ...(current !== null ? current : {}), ...delta.data.usage }

  const completed = ResponsesCompletedEventSchema.safeParse(obj)
  if (completed.success) return { ...completed.data.response.usage }

  const chunk = ChatCompletionUsageChunkSchema.safeParse(obj)
  if (chunk.success) return { ...chunk.data.usage }

  return current
}

function fallbackJsonParse(text: string): UsageBlock | null {
  try {
    const result = JsonResponseWithUsageSchema.safeParse(JSON.parse(text))
    if (result.success && result.data.usage) return result.data.usage
  } catch {
    // not JSON
  }
  return null
}

// Re-export helper types used by tests / callers that previously imported
// them from this file.
export type { PipelineBodyView, TransformerHookResult }
