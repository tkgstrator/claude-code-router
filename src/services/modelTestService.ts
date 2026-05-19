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

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getPrismaClient } from '../db/client'
import { ApiStyle, AuthMode, ModelTestStatus, type PrismaClient } from '../generated/prisma/client'
import dayjs from '../lib/dayjs'
import { getSubscriptionsInfo } from './subscriptionInfoService'

// Read the OAuth access token a subscription provider authenticates
// with, so the test makes a *real* authed call (not just a
// file-presence check). Mirrors how the llms claude-code-credentials
// transformer / subscriptionInfoService read the same files.
interface SubAuth {
  token: string
  extraHeaders?: Record<string, string>
}
const readSubscriptionAuth = async (apiBaseUrl: string): Promise<SubAuth | { error: string }> => {
  const readJson = async <T>(path: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as T
    } catch {
      return null
    }
  }
  if (apiBaseUrl.includes('anthropic.com')) {
    const data = await readJson<{ claudeAiOauth?: { accessToken?: string; expiresAt?: number } }>(
      join(homedir(), '.claude', '.credentials.json')
    )
    const oauth = data?.claudeAiOauth
    if (!oauth?.accessToken) return { error: 'no Claude subscription credentials on disk' }
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt < dayjs().valueOf()) {
      return { error: 'Claude subscription token expired — re-login with the Claude CLI' }
    }
    // Claude Code sends the OAuth token as x-api-key (see the llms
    // claude-code-credentials transformer).
    return { token: oauth.accessToken }
  }
  if (apiBaseUrl.includes('chatgpt.com') || apiBaseUrl.includes('openai.com')) {
    const data = await readJson<{ tokens?: { access_token?: string; account_id?: string } }>(
      join(homedir(), '.codex', 'auth.json')
    )
    const tok = data?.tokens
    if (!tok?.access_token) return { error: 'no Codex subscription credentials on disk' }
    return {
      token: tok.access_token,
      extraHeaders: tok.account_id ? { 'chatgpt-account-id': tok.account_id } : {}
    }
  }
  return { error: `no subscription credential reader for ${apiBaseUrl}` }
}

export interface ModelTestResult {
  provider: string
  model: string
  status: 'ok' | 'fail'
  error?: string
  latencyMs: number
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

const probeInference = async (
  style: ApiStyle,
  baseUrl: string,
  apiKey: string,
  model: string,
  // Extra headers for subscription auth (e.g. codex's
  // chatgpt-account-id). Merged into every variant's request.
  extraHeaders: Record<string, string> = {}
): Promise<{ ok: boolean; error?: string }> => {
  // A 400 saying the output budget was exhausted means the model
  // actually ran (auth ok, model exists) — it just couldn't finish
  // within our deliberately tiny 1-token cap. For a reachability test
  // that's a pass; reasoning models spend the budget on hidden
  // reasoning and never emit a token here.
  const budgetExhausted = (s: number, b: string) =>
    s === 400 &&
    /could not finish the message because max_tokens|model output limit was reached|max_output_tokens/i.test(b)
  // A 429 means the credential authenticated and the endpoint is
  // reachable — we're just throttled. For a connectivity/auth test
  // that's a pass (same intent as budgetExhausted).
  const reachable = (s: number, b: string) => s === 429 || budgetExhausted(s, b)
  try {
    if (style === ApiStyle.anthropic) {
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

    if (style === ApiStyle.gemini) {
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
    const probeResponses = async (chatOrResponsesUrl: string): Promise<{ ok: boolean; error?: string }> => {
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

    if (style === ApiStyle.openai_responses) {
      // baseUrl is already the /v1/responses endpoint.
      return probeResponses(baseUrl)
    }

    // ApiStyle.openai_chat — chat completions; baseUrl is the chat
    // endpoint. gpt-5 / o-series reject `max_tokens` and require
    // `max_completion_tokens`; older gpt-4 / OpenAI-compatible vendors
    // only know `max_tokens`. Send `max_tokens` first and retry once
    // with `max_completion_tokens` when the vendor explicitly rejects
    // the former, so both generations pass.
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
  await prisma.model.update({
    where: { id: modelId },
    data: {
      testStatus: ok ? ModelTestStatus.ok : ModelTestStatus.fail,
      testCheckedAt: now,
      testError: ok ? null : (error ?? 'unknown error'),
      ...(ok ? { testPassedAt: now } : {})
    }
  })
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
    return {
      provider: providerName,
      model: modelName,
      status: 'fail',
      error: 'model not found on provider',
      latencyMs: dayjs().diff(start)
    }
  }

  // Authoritative enabled check from the DB — never trust the caller.
  // A disabled model is not tested or billed; its stored status is
  // left untouched.
  if (!modelRow.enabled) {
    return {
      provider: providerName,
      model: modelName,
      status: 'fail',
      error: 'model is disabled',
      latencyMs: dayjs().diff(start)
    }
  }

  // Subscription providers (claude-code / codex): make a *real* authed
  // call with the OAuth token from the credential file — not just a
  // file-presence check.
  if (provider.authMode === AuthMode.subscription) {
    const auth = await readSubscriptionAuth(provider.apiBaseUrl)
    if ('error' in auth) {
      await persist(prisma, modelRow.id, false, auth.error)
      return {
        provider: providerName,
        model: modelName,
        status: 'fail',
        error: auth.error,
        latencyMs: dayjs().diff(start)
      }
    }
    const subStyle = modelRow.apiStyle ?? provider.apiStyle
    const subProbe = await probeInference(subStyle, provider.apiBaseUrl, auth.token, modelName, auth.extraHeaders)
    await persist(prisma, modelRow.id, subProbe.ok, subProbe.error)
    return {
      provider: providerName,
      model: modelName,
      status: subProbe.ok ? 'ok' : 'fail',
      error: subProbe.ok ? undefined : subProbe.error,
      latencyMs: dayjs().diff(start)
    }
  }

  if (!provider.apiKey || provider.apiKey.trim() === '') {
    await persist(prisma, modelRow.id, false, 'no api key on file')
    return {
      provider: providerName,
      model: modelName,
      status: 'fail',
      error: 'no api key on file',
      latencyMs: dayjs().diff(start)
    }
  }

  // Per-model override wins; otherwise the provider's style. Both are
  // explicit DB values — no endpoint guessing / 404 probing.
  const effectiveStyle = modelRow.apiStyle ?? provider.apiStyle
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

export interface TestAllOutcome {
  total: number
  ok: number
  fail: number
  results: ModelTestResult[]
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
