/**
 * Real-inference connectivity test for a single Model.
 *
 * Unlike providerTestService (which only hits the vendor's /v1/models
 * list to check the key), this sends a minimal real completion request
 * (max 1 output token, "ping") to the specific model and records the
 * outcome on the Model row (testStatus / testCheckedAt / testPassedAt /
 * testError).
 *
 * Request shaping is driven by the vendor's auth style:
 *   - x-api-key       -> Anthropic /v1/messages
 *   - google-key-param-> Gemini :generateContent
 *   - bearer / other  -> OpenAI-compatible /chat/completions
 *
 * Subscription-auth providers can't do a keyless real call here, so
 * they fall back to the credential reachability check.
 */

import type { z } from '@hono/zod-openapi'
import { isTransformerHookResult, type RuntimeProvider } from '@/schemas'
import { getPrismaClient } from '../db/client'
import { ApiStyle, AuthMode, ModelTestStatus, type PrismaClient } from '../generated/prisma/client'
import dayjs from '../lib/dayjs'
import { ClaudeCodeOauthTransformer } from '../llms/transformers/claude-code-oauth'
import type { ModelTestAllResponseSchema, ModelTestResultSchema } from '../schemas/model.dto'
import { getActiveSubAccountAuth } from './subscription-account-sync-service'
import { getSubscriptionsInfo } from './subscription-info-service'

export type ModelTestResult = z.infer<typeof ModelTestResultSchema>
export type TestAllOutcome = z.infer<typeof ModelTestAllResponseSchema>

// Local, structural type. Never crosses the wire, so no schema/openapi
// envelope is needed.
type SubAuth = { token: string; extraHeaders?: Record<string, string> }

// Read the OAuth access token the provider's active SubAccount is bound
// to (decrypted in-memory). The test then makes a *real* authed call
// against the upstream — file-presence checks went away with the move
// to DB-only credential storage.
const readSubscriptionAuth = async (providerName: string, apiBaseUrl: string): Promise<SubAuth | { error: string }> => {
  const auth = await getActiveSubAccountAuth(providerName)
  if (!auth?.accessToken) return { error: 'no active subscription account on this provider' }
  if (apiBaseUrl.includes('chatgpt.com') || apiBaseUrl.includes('openai.com')) {
    return {
      token: auth.accessToken,
      extraHeaders: auth.accountId ? { 'chatgpt-account-id': auth.accountId } : {}
    }
  }
  // Claude Code sends the OAuth token as x-api-key (handled by the
  // claude-code-oauth transformer at proxy time; the test path uses it
  // as a bearer below).
  return { token: auth.accessToken }
}

const TIMEOUT_MS = 20_000

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

type ProbeResult = { ok: boolean; error?: string }

// A 400 saying the output budget was exhausted means the model
// actually ran (auth ok, model exists) — it just couldn't finish
// within our deliberately tiny 1-token cap. For a reachability test
// that's a pass; reasoning models spend the budget on hidden
// reasoning and never emit a token here.
const budgetExhausted = (s: number, b: string): boolean =>
  s === 400 &&
  /could not finish the message because max_tokens|model output limit was reached|max_output_tokens/i.test(b)

// A 429 means the credential authenticated and the endpoint is
// reachable — we're just throttled. For a connectivity/auth test
// that's a pass (same intent as budgetExhausted).
const reachable = (s: number, b: string): boolean => s === 429 || budgetExhausted(s, b)

const probeAnthropic = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  extraHeaders: Record<string, string>
): Promise<ProbeResult> => {
  const res = await fetchWithTimeout(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }]
    })
  })
  if (res.ok) return { ok: true }
  const ab = (await res.text()).slice(0, 300)
  if (reachable(res.status, ab)) return { ok: true }
  return { ok: false, error: `HTTP ${res.status}: ${ab.slice(0, 200)}` }
}

const probeGemini = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  extraHeaders: Record<string, string>
): Promise<ProbeResult> => {
  // baseUrl ends with /v1beta/models/ — resolve relative to it.
  const url = new URL(`./${model}:generateContent`, baseUrl)
  url.searchParams.set('key', apiKey)
  const res = await fetchWithTimeout(url.href, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 1 }
    })
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
}

// OpenAI Responses API call. The provider's base URL may be the
// chat-completions endpoint (codex models live under the regular
// openai provider via a per-model apiStyle override), so normalise
// it to /responses; if it's already /responses it's unchanged.
const probeResponses = async (
  chatOrResponsesUrl: string,
  apiKey: string,
  model: string,
  extraHeaders: Record<string, string>
): Promise<ProbeResult> => {
  // Normalise to the /responses endpoint: replace a trailing
  // /chat/completions, otherwise append /responses if absent.
  const responsesUrl = /\/responses\/?$/.test(chatOrResponsesUrl)
    ? chatOrResponsesUrl
    : /\/chat\/completions\/?$/.test(chatOrResponsesUrl)
      ? chatOrResponsesUrl.replace(/\/chat\/completions(\/?)$/, '/responses$1')
      : `${chatOrResponsesUrl.replace(/\/$/, '')}/responses`
  const res = await fetchWithTimeout(responsesUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...extraHeaders
    },
    // chatgpt.com/backend-api/codex requires: `instructions`,
    // `input` as a list, store=false, stream=true. All are valid
    // on the public Responses API too, so one body serves both.
    body: JSON.stringify({
      model,
      instructions: 'ping',
      input: [{ role: 'user', content: 'ping' }],
      max_output_tokens: 1,
      store: false,
      stream: true
    })
  })
  if (res.ok) {
    // Streaming response — a 200 means auth + reachability are
    // proven; don't consume the stream, just release it.
    await res.body?.cancel().catch(() => {})
    return { ok: true }
  }
  const rbody = (await res.text()).slice(0, 300)
  if (reachable(res.status, rbody)) return { ok: true }
  return { ok: false, error: `HTTP ${res.status}: ${rbody.slice(0, 200)}` }
}

// ApiStyle.openai_chat — chat completions; baseUrl is the chat
// endpoint. gpt-5 / o-series reject `max_tokens` and require
// `max_completion_tokens`; older gpt-4 / OpenAI-compatible vendors
// only know `max_tokens`. Send `max_tokens` first and retry once
// with `max_completion_tokens` when the vendor explicitly rejects
// the former, so both generations pass.
const probeOpenAIChat = async (baseUrl: string, apiKey: string, model: string): Promise<ProbeResult> => {
  const callChat = (tokenField: 'max_tokens' | 'max_completion_tokens') =>
    fetchWithTimeout(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        [tokenField]: 1,
        messages: [{ role: 'user', content: 'ping' }]
      })
    })

  const res = await callChat('max_tokens')
  if (res.ok) return { ok: true }
  const body = (await res.text()).slice(0, 300)
  if (reachable(res.status, body)) return { ok: true }
  const wantsCompletionTokens = res.status === 400 && /max_tokens/.test(body) && /max_completion_tokens/.test(body)
  if (wantsCompletionTokens) {
    const retry = await callChat('max_completion_tokens')
    if (retry.ok) return { ok: true }
    const retryBody = (await retry.text()).slice(0, 300)
    if (reachable(retry.status, retryBody)) return { ok: true }
    return { ok: false, error: `HTTP ${retry.status}: ${retryBody.slice(0, 200)}` }
  }
  return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
}

const probeInference = async (
  style: ApiStyle,
  baseUrl: string,
  apiKey: string,
  model: string,
  // Extra headers for subscription auth (e.g. codex's
  // chatgpt-account-id). Merged into every variant's request.
  extraHeaders: Record<string, string> = {}
): Promise<ProbeResult> => {
  try {
    if (style === ApiStyle.anthropic) {
      return await probeAnthropic(baseUrl, apiKey, model, extraHeaders)
    }
    if (style === ApiStyle.gemini) {
      return await probeGemini(baseUrl, apiKey, model, extraHeaders)
    }
    if (style === ApiStyle.openai_responses) {
      // baseUrl is already the /v1/responses endpoint.
      return await probeResponses(baseUrl, apiKey, model, extraHeaders)
    }
    return await probeOpenAIChat(baseUrl, apiKey, model)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' }
  }
}

const persist = async (
  prisma: PrismaClient,
  modelId: string,
  ok: boolean,
  error: string | undefined
): Promise<void> => {
  const now = dayjs().toDate()
  // Prefer ternary over `??` so the no-nullish-coalescing lint stays
  // happy; the fallback is purely defensive (probe errors always carry
  // a message in practice).
  const failureMessage = error ? error : 'unknown error'
  await prisma.model.update({
    where: { id: modelId },
    data: {
      testStatus: ok ? ModelTestStatus.ok : ModelTestStatus.fail,
      testCheckedAt: now,
      testError: ok ? null : failureMessage,
      ...(ok ? { testPassedAt: now } : {})
    }
  })
}

// Per-model apiStyle override wins; otherwise fall back to the
// provider's style. Plain ternary so the no-nullish-coalescing lint
// stays happy.
const resolveStyle = (modelStyle: ApiStyle | null, providerStyle: ApiStyle): ApiStyle =>
  modelStyle !== null ? modelStyle : providerStyle

const failResult = (provider: string, model: string, error: string, start: dayjs.Dayjs): ModelTestResult => ({
  provider,
  model,
  status: 'fail',
  error,
  latencyMs: dayjs().diff(start)
})

// anthropic-beta value the /v1 adapter (api/v1/route.ts) injects on the
// subscription OAuth path. The claude-code-oauth transformer's auth() omits
// it by design (the adapter owns it), so the test adds it to mirror the
// proxy exactly.
const OAUTH_BETA = 'oauth-2025-04-20'

// Claude Code subscription probe. Rather than hand-rolling the OAuth auth
// headers + the Claude Code identity block — which silently drift from the
// real request shape — build the upstream request with the SAME
// claude-code-oauth transformer the proxy runs, then add the adapter's oauth
// beta header. Single source of truth: if the transformer changes, the test
// follows automatically.
// Build the upstream { headers, body } for a Claude Code subscription ping by
// running the real claude-code-oauth transformer, then layering the adapter's
// oauth beta header. Returns { error } when there's no active account or the
// transformer's auth hook throws.
const buildClaudeCodeRequest = async (
  providerName: string,
  apiBaseUrl: string,
  model: string
): Promise<{ headers: Record<string, string>; body: string } | { error: string }> => {
  const overlay = await getActiveSubAccountAuth(providerName)
  if (!overlay?.accessToken) {
    return { error: 'no active subscription account on this provider' }
  }
  const runtimeProvider: RuntimeProvider = {
    name: providerName,
    api_base_url: apiBaseUrl,
    api_key: 'oauth',
    // resolveSubscriptionAuth reads the bearer back out of this overlay —
    // the same block the pipeline grafts on at request time.
    transformer: { use: [], subscriptionAuth: overlay }
  }
  const pingBody = { model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
  let shaped: unknown
  try {
    shaped = await new ClaudeCodeOauthTransformer().auth(pingBody, runtimeProvider, {})
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'subscription auth failed' }
  }
  const hook = isTransformerHookResult(shaped) ? shaped : { body: pingBody, config: undefined }
  const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-beta': OAUTH_BETA }
  const shapedHeaders = hook.config?.headers
  if (shapedHeaders) {
    // Skip undefined values: the transformer sets `x-api-key: undefined` to
    // unset the inbound key, but fetch can't take an undefined header value.
    for (const [k, v] of Object.entries(shapedHeaders)) {
      if (typeof v === 'string') headers[k] = v
    }
  }
  return { headers, body: JSON.stringify(hook.body) }
}

const probeClaudeCodeSubscription = async (
  providerName: string,
  apiBaseUrl: string,
  model: string
): Promise<ProbeResult> => {
  const built = await buildClaudeCodeRequest(providerName, apiBaseUrl, model)
  if ('error' in built) return { ok: false, error: built.error }
  try {
    const res = await fetchWithTimeout(apiBaseUrl, { method: 'POST', headers: built.headers, body: built.body })
    if (res.ok) return { ok: true }
    const ab = (await res.text()).slice(0, 300)
    if (reachable(res.status, ab)) return { ok: true }
    return { ok: false, error: `HTTP ${res.status}: ${ab.slice(0, 200)}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' }
  }
}

// Subscription probe dispatch. Anthropic (Claude Code) reuses the real
// transformer; codex (Responses API to the ChatGPT backend) uses the token +
// chatgpt-account-id responses probe.
const probeSubscription = async (
  style: ApiStyle,
  providerName: string,
  apiBaseUrl: string,
  modelName: string
): Promise<ProbeResult> => {
  if (style === ApiStyle.anthropic) {
    return probeClaudeCodeSubscription(providerName, apiBaseUrl, modelName)
  }
  const auth = await readSubscriptionAuth(providerName, apiBaseUrl)
  if ('error' in auth) return { ok: false, error: auth.error }
  return probeInference(style, apiBaseUrl, auth.token, modelName, auth.extraHeaders)
}

const runSubscriptionTest = async (
  prisma: PrismaClient,
  providerName: string,
  modelName: string,
  apiBaseUrl: string,
  style: ApiStyle,
  modelId: string,
  start: dayjs.Dayjs
): Promise<ModelTestResult> => {
  const probe = await probeSubscription(style, providerName, apiBaseUrl, modelName)
  await persist(prisma, modelId, probe.ok, probe.error)
  return {
    provider: providerName,
    model: modelName,
    status: probe.ok ? 'ok' : 'fail',
    error: probe.ok ? undefined : probe.error,
    latencyMs: dayjs().diff(start)
  }
}

export async function testModel(
  providerName: string,
  modelName: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<ModelTestResult> {
  const start = dayjs()
  const provider = await prisma.provider.findUnique({
    where: { name: providerName },
    include: { models: { where: { name: modelName } } }
  })
  if (!provider) {
    return { provider: providerName, model: modelName, status: 'fail', error: 'provider not found', latencyMs: 0 }
  }
  const modelRow = provider.models[0]
  if (!modelRow) {
    return failResult(providerName, modelName, 'model not found on provider', start)
  }

  // Authoritative enabled check from the DB — never trust the caller.
  // A disabled model is not tested or billed; its stored status is
  // left untouched.
  if (!modelRow.enabled) {
    return failResult(providerName, modelName, 'model is disabled', start)
  }

  const effectiveStyle = resolveStyle(modelRow.apiStyle, provider.apiStyle)

  // Subscription providers (claude-code / codex): make a *real* authed
  // call with the OAuth token from the credential file — not just a
  // file-presence check.
  if (provider.authMode === AuthMode.subscription) {
    return runSubscriptionTest(prisma, providerName, modelName, provider.apiBaseUrl, effectiveStyle, modelRow.id, start)
  }

  if (!provider.apiKey || provider.apiKey.trim() === '') {
    await persist(prisma, modelRow.id, false, 'no api key on file')
    return failResult(providerName, modelName, 'no api key on file', start)
  }

  // Both apiStyle inputs are explicit DB values — no endpoint guessing
  // / 404 probing.
  const probe = await probeInference(effectiveStyle, provider.apiBaseUrl, provider.apiKey, modelName)
  await persist(prisma, modelRow.id, probe.ok, probe.error)
  return {
    provider: providerName,
    model: modelName,
    status: probe.ok ? 'ok' : 'fail',
    error: probe.ok ? undefined : probe.error,
    latencyMs: dayjs().diff(start)
  }
}

// scope 'all' tests every enabled Model; 'failing' only enabled models
// whose current testStatus !== ok (never-tested + previously-failed).
// Models on providers with no usable credentials (api_key blank, or
// subscription without valid creds) are skipped entirely — there's no
// point spending a request to get "no api key on file". enabled is the
// authoritative DB column. Sequential to avoid rate-limit/billed
// bursts.
export async function testAllModels(
  scope: 'all' | 'failing',
  prisma: PrismaClient = getPrismaClient()
): Promise<TestAllOutcome> {
  const models = await prisma.model.findMany({
    where: {
      enabled: true,
      ...(scope === 'failing' ? { testStatus: { not: ModelTestStatus.ok } } : {})
    },
    include: { provider: { select: { name: true, apiKey: true, authMode: true } } },
    orderBy: [{ provider: { name: 'asc' } }, { name: 'asc' }]
  })

  // Which subscription providers actually have valid, unexpired creds.
  const subs = await getSubscriptionsInfo()
  const validSubscription = new Set(
    subs
      .filter(
        (s) =>
          s.enabled &&
          s.activeAccount?.plan &&
          !(s.activeAccount.expiresAt && s.activeAccount.expiresAt < dayjs().valueOf())
      )
      .map((s) => s.providerName)
  )
  const hasCredentials = (p: { name: string; apiKey: string | null; authMode: AuthMode }): boolean =>
    p.authMode === AuthMode.subscription
      ? validSubscription.has(p.name)
      : p.apiKey !== null && p.apiKey.trim().length > 0

  const results: ModelTestResult[] = []
  for (const m of models) {
    if (!hasCredentials(m.provider)) continue
    results.push(await testModel(m.provider.name, m.name, prisma))
  }
  return {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    fail: results.filter((r) => r.status === 'fail').length,
    results
  }
}
