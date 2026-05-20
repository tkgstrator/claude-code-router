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
import { fetchProvider } from './provider-fetch'
import type { ResolvedProvider, ResolvedProviderTransformer } from './registry/provider'
import type { Transformer } from './transformers/base'
import type { TransformerConfig, TransformerContext, TransformerHookResult, UnifiedChatRequest } from './types'

export interface PipelineDeps {
  log: Logger
  /** Outbound HTTPS proxy URL, if any. */
  httpsProxy?: string
  /** Hook to write a usage row to the request_logs table (best-effort). */
  recordUsage?: (entry: UsageRecord) => Promise<void>
}

export interface UsageRecord {
  sessionId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalInputTokens: number
  cacheHitPct: number
  durationMs: number
  status: number
}

export interface PipelineInput {
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
  const model = typeof body.model === 'string' ? body.model : ''
  const modelBlock = model ? (providerTx?.[model] as { use?: Transformer[] } | undefined) : undefined
  const modelUse = modelBlock?.use
  if (!modelUse || modelUse.length === 0) return true
  return modelUse.length === 1 && modelUse[0].name === transformer.name
}

// ─── Request chain ──────────────────────────────────────────────────────

async function processRequestTransformers(
  input: PipelineInput,
  bypass: boolean
): Promise<{ requestBody: unknown; config: TransformerConfig }> {
  let requestBody: unknown = input.body
  let config: TransformerConfig = {}

  if (bypass) {
    // Strip content-length: the upstream body will be re-serialized.
    const headers: Record<string, string | undefined> = { ...input.headers }
    delete headers['content-length']
    delete headers['Content-Length']
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
    const result = await step.transformRequestIn(requestBody as UnifiedChatRequest, input.provider, input.context)
    ;({ requestBody, config } = mergeHookResult(result, requestBody, config))
  }

  // 3. Model-specific chain.
  const model = (requestBody as { model?: unknown })?.model
  const modelKey = typeof model === 'string' ? model : ''
  const modelBlock = modelKey ? (providerTx?.[modelKey] as { use?: Transformer[] } | undefined) : undefined
  for (const step of modelBlock?.use ?? []) {
    const result = await step.transformRequestIn(requestBody as UnifiedChatRequest, input.provider, input.context)
    ;({ requestBody, config } = mergeHookResult(result, requestBody, config))
  }

  return { requestBody, config }
}

function mergeHookResult(
  result: TransformerHookResult | UnifiedChatRequest | unknown,
  prevBody: unknown,
  prevConfig: TransformerConfig
): { requestBody: unknown; config: TransformerConfig } {
  if (
    result &&
    typeof result === 'object' &&
    'body' in result &&
    (result as TransformerHookResult).body !== undefined
  ) {
    const hook = result as TransformerHookResult
    return {
      requestBody: hook.body,
      config: { ...prevConfig, ...(hook.config ?? {}) }
    }
  }
  return { requestBody: result ?? prevBody, config: prevConfig }
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
  let body = requestBody
  let outConfig = config

  // Bypass-mode auth hook (subscription OAuth flows live here).
  if (bypass) {
    const auth = await transformer.auth(body, provider, context)
    if (
      auth &&
      typeof auth === 'object' &&
      'body' in (auth as object) &&
      (auth as TransformerHookResult).body !== undefined
    ) {
      const a = auth as TransformerHookResult
      body = a.body
      let headers: Record<string, string | undefined> = { ...(outConfig.headers ?? {}) }
      if (a.config?.headers) {
        // Drop every case variant of inbound auth headers before merging
        // the transformer's upstream auth — otherwise inbound lowercase
        // `authorization` lingers and Headers.set() (case-insensitive)
        // can pick the wrong value.
        for (const k of Object.keys(headers)) {
          const lower = k.toLowerCase()
          if (lower === 'authorization' || lower === 'x-api-key') delete headers[k]
        }
        headers = { ...headers, ...a.config.headers }
        delete headers.host
      }
      outConfig = { ...outConfig, ...a.config, headers }
    } else {
      body = auth
    }
  }

  const url = outConfig.url ?? new URL(provider.api_base_url)

  // One id per upstream send. LogViewer groups a request's lines by
  // reqId — bind it on a child logger so request body / response /
  // error all carry the same id.
  const reqId = randomUUID()
  const reqLog = deps.log.child({ reqId })
  const startedAt = Date.now()

  // Build header set: provider Bearer (overwritten by transformer auth
  // headers, if any), then merge transformer-provided headers.
  const headers: Record<string, string | undefined> = {
    Authorization: `Bearer ${provider.api_key}`,
    ...(outConfig.headers ?? {})
  }
  for (const k of Object.keys(headers)) {
    const v = headers[k]
    if (v === 'undefined') delete headers[k]
    else if (k.toLowerCase() === 'authorization' && typeof v === 'string' && v.includes('undefined')) delete headers[k]
  }

  reqLog.debug(
    {
      type: 'request body',
      data: {
        provider: provider.name,
        model: (body as { model?: unknown } | null)?.model,
        url: String(url),
        stream: (body as { stream?: unknown } | null)?.stream === true,
        bypass,
        messages: Array.isArray((body as { messages?: unknown[] } | null)?.messages)
          ? (body as { messages: unknown[] }).messages.length
          : undefined,
        tools: Array.isArray((body as { tools?: unknown[] } | null)?.tools)
          ? (body as { tools: unknown[] }).tools.length
          : undefined
      }
    },
    'llm request'
  )

  const response = await fetchProvider(url, body, { headers, httpsProxy: deps.httpsProxy }, { reqId }, reqLog)
  const durationMs = Date.now() - startedAt

  if (!response.ok) {
    const errorText = await response.text()
    const isSubscription = transformer.name.endsWith('-oauth')
    const model = (body as { model?: string } | null)?.model ?? 'unknown'

    // KEEP this message byte-for-byte: v1/route.ts has a regex
    // (PROVIDER_ERR_RE) that parses "Error from provider(<name>,<model>:
    // <status>): <rawBody>" to forward the genuine upstream error to
    // Claude Code verbatim.
    const message = `Error from provider(${provider.name},${model}: ${response.status}): ${errorText}`
    reqLog.error(
      {
        type: 'response',
        provider: provider.name,
        model,
        status: response.status,
        durationMs,
        body: errorText
      },
      `[provider_response_error] ${message}`
    )

    if ((response.status === 401 || response.status === 403) && isSubscription) {
      reqLog.error(
        { provider: provider.name, status: response.status },
        `Subscription auth rejected by '${provider.name}' (${response.status}). ` +
          'If the OAuth credentials are absent/expired, re-authenticate ' +
          'the underlying CLI (run `claude` and sign in for claude-code, ' +
          'or `codex login` for codex) to refresh the credentials file.'
      )
    }
    throw new HTTPException(response.status as never, { message })
  }

  reqLog.debug(
    {
      type: 'response',
      provider: provider.name,
      model: (body as { model?: unknown } | null)?.model,
      status: response.status,
      durationMs
    },
    `${provider.name}/${(body as { model?: unknown } | null)?.model} ${response.status} ${durationMs}ms`
  )

  // Best-effort usage capture from a cloned stream so the completion
  // log carries token + cache stats. Never blocks the response.
  if (deps.recordUsage && typeof response.clone === 'function') {
    const clone = response.clone()
    void captureUsage(clone, context, provider, body, response.status, durationMs, deps).catch(() => {})
  }

  return response
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
  const model = (requestBody as { model?: unknown })?.model
  const modelKey = typeof model === 'string' ? model : ''
  const modelBlock = modelKey ? (providerTx?.[modelKey] as { use?: Transformer[] } | undefined) : undefined
  for (const step of modelBlock?.use ? [...modelBlock.use].reverse() : []) {
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

  const headers = context.req?.headers ?? {}
  const sessionId =
    (typeof headers.thread_id === 'string' ? headers.thread_id : undefined) ??
    (typeof headers['x-claude-code-session-id'] === 'string' ? headers['x-claude-code-session-id'] : undefined) ??
    randomUUID()

  const cachedTokens =
    Number(usage.cache_read_input_tokens ?? 0) || Number(usage.input_tokens_details?.cached_tokens ?? 0)
  const writtenTokens = Number(usage.cache_creation_input_tokens ?? 0)
  const outputTokens = Number(usage.output_tokens ?? 0) || Number(usage.completion_tokens ?? 0)
  // Anthropic input_tokens is the non-cached portion only; OpenAI uses prompt_tokens.
  const rawInput = Number(usage.input_tokens ?? 0) || Number(usage.prompt_tokens ?? 0)
  const totalInputTokens = rawInput + writtenTokens + cachedTokens
  const cacheHitPct = totalInputTokens > 0 ? Math.round((cachedTokens / totalInputTokens) * 100) : 0

  await deps.recordUsage?.({
    sessionId,
    provider: provider.name,
    model: (body as { model?: string } | null)?.model ?? 'unknown',
    inputTokens: rawInput,
    outputTokens,
    cacheReadTokens: cachedTokens,
    cacheWriteTokens: writtenTokens,
    totalInputTokens,
    cacheHitPct,
    durationMs,
    status
  })
}

interface UsageBlock {
  input_tokens?: number
  output_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
}

async function extractUsage(resp: Response): Promise<UsageBlock | null> {
  try {
    const ct = (resp.headers.get('content-type') ?? '').toLowerCase()
    if (ct.includes('application/json')) {
      const j = (await resp.json().catch(() => null)) as { usage?: UsageBlock } | null
      return j?.usage ?? null
    }
    // SSE or unknown content type — parse line-by-line.
    const text = await resp.text()
    let usage: UsageBlock | null = null
    for (const block of text.split('\n\n')) {
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      const raw = dataLine.slice(5).trim()
      if (raw === '[DONE]') continue
      let obj: Record<string, unknown> | null = null
      try {
        obj = JSON.parse(raw)
      } catch {
        continue
      }
      if (!obj) continue
      // Anthropic SSE
      if (obj.type === 'message_start' && (obj.message as { usage?: UsageBlock } | undefined)?.usage) {
        usage = { ...(obj.message as { usage: UsageBlock }).usage }
      } else if (obj.type === 'message_delta' && obj.usage) {
        usage = { ...(usage ?? {}), ...(obj.usage as UsageBlock) }
      } else if (obj.type === 'response.completed' && (obj.response as { usage?: UsageBlock } | undefined)?.usage) {
        usage = { ...(obj.response as { usage: UsageBlock }).usage }
      } else if (obj.usage && typeof (obj.usage as UsageBlock).prompt_tokens === 'number') {
        usage = { ...(obj.usage as UsageBlock) }
      }
    }
    if (!usage) {
      try {
        const j = JSON.parse(text) as { usage?: UsageBlock }
        if (j?.usage) usage = j.usage
      } catch {
        // not JSON
      }
    }
    return usage
  } catch {
    return null
  }
}
