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

import { VENDOR_DEFAULTS } from '@ccr/shared'
import { getPrismaClient } from '../db/client'
import { AuthMode, ModelTestStatus, type PrismaClient } from '../generated/prisma/client'
import { getSubscriptionsInfo } from './subscriptionInfoService'

export interface ModelTestResult {
  provider: string
  model: string
  status: 'ok' | 'fail'
  error?: string
  latencyMs: number
}

const TIMEOUT_MS = 20_000

type VendorStyle = 'anthropic' | 'gemini' | 'openai'

const styleFor = (vendor: string): VendorStyle => {
  const auth = VENDOR_DEFAULTS[vendor]?.modelsAuth
  if (auth === 'x-api-key') return 'anthropic'
  if (auth === 'google-key-param') return 'gemini'
  return 'openai'
}

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
  vendor: string,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<{ ok: boolean; error?: string }> => {
  const style = styleFor(vendor)
  try {
    if (style === 'anthropic') {
      const res = await fetchWithTimeout(baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      })
      if (res.ok) return { ok: true }
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
    }

    if (style === 'gemini') {
      // baseUrl ends with /v1beta/models/ — resolve relative to it.
      const url = new URL(`./${model}:generateContent`, baseUrl)
      url.searchParams.set('key', apiKey)
      const res = await fetchWithTimeout(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1 }
        })
      })
      if (res.ok) return { ok: true }
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
    }

    // openai-compatible chat completions; baseUrl is the chat endpoint.
    // gpt-5 / o-series reject `max_tokens` and require
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

    // A 400 that says the output budget was exhausted means the model
    // actually ran (auth ok, model exists) — it just couldn't finish
    // within our deliberately tiny 1-token cap. For a reachability
    // test that's a pass; reasoning models (gpt-5 / o-series) spend
    // the budget on hidden reasoning and can never emit a token here.
    const budgetExhausted = (s: number, b: string) =>
      s === 400 && /could not finish the message because max_tokens|model output limit was reached/i.test(b)

    const res = await callChat('max_tokens')
    if (res.ok) return { ok: true }
    const body = (await res.text()).slice(0, 300)
    if (budgetExhausted(res.status, body)) return { ok: true }
    const wantsCompletionTokens =
      res.status === 400 && /max_tokens/.test(body) && /max_completion_tokens/.test(body)
    if (wantsCompletionTokens) {
      const retry = await callChat('max_completion_tokens')
      if (retry.ok) return { ok: true }
      const retryBody = (await retry.text()).slice(0, 300)
      if (budgetExhausted(retry.status, retryBody)) return { ok: true }
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
  const now = new Date()
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
  const start = Date.now()
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
      latencyMs: Date.now() - start
    }
  }

  // Subscription providers: no API key to do a real keyless call —
  // fall back to credential reachability.
  if (provider.authMode === AuthMode.subscription) {
    const subs = await getSubscriptionsInfo()
    const match = subs.find((s) => s.providerName === providerName)
    const okSub = Boolean(match?.plan) && !(match?.expiresAt && match.expiresAt < Date.now())
    const subErr = !match?.plan
      ? 'no subscription credentials on disk'
      : match?.expiresAt && match.expiresAt < Date.now()
        ? 'subscription token expired'
        : undefined
    await persist(prisma, modelRow.id, okSub, subErr)
    return {
      provider: providerName,
      model: modelName,
      status: okSub ? 'ok' : 'fail',
      error: okSub ? undefined : subErr,
      latencyMs: Date.now() - start
    }
  }

  if (!provider.apiKey || provider.apiKey.trim() === '') {
    await persist(prisma, modelRow.id, false, 'no api key on file')
    return {
      provider: providerName,
      model: modelName,
      status: 'fail',
      error: 'no api key on file',
      latencyMs: Date.now() - start
    }
  }

  const probe = await probeInference(provider.name, provider.apiBaseUrl, provider.apiKey, modelName)
  await persist(prisma, modelRow.id, probe.ok, probe.error)
  return {
    provider: providerName,
    model: modelName,
    status: probe.ok ? 'ok' : 'fail',
    error: probe.ok ? undefined : probe.error,
    latencyMs: Date.now() - start
  }
}

export interface TestAllOutcome {
  total: number
  ok: number
  fail: number
  results: ModelTestResult[]
}

// scope 'all' tests every Model; 'failing' only those whose current
// testStatus !== ok (never-tested + previously-failed). Sequential to
// avoid rate-limit/billed bursts.
export async function testAllModels(
  scope: 'all' | 'failing',
  prisma: PrismaClient = getPrismaClient()
): Promise<TestAllOutcome> {
  const models = await prisma.model.findMany({
    where: scope === 'failing' ? { testStatus: { not: ModelTestStatus.ok } } : {},
    include: { provider: { select: { name: true } } },
    orderBy: [{ provider: { name: 'asc' } }, { name: 'asc' }]
  })
  const results: ModelTestResult[] = []
  for (const m of models) {
    results.push(await testModel(m.provider.name, m.name, prisma))
  }
  return {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    fail: results.filter((r) => r.status === 'fail').length,
    results
  }
}
