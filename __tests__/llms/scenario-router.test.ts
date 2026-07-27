import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'
import type { Logger } from 'pino'
import { ConfigStore } from '../../src/llms/registry/config'
import {
  applyProactiveFailover,
  candidateUsable,
  isHeavyRequest,
  type RouterRequest,
  selectModel
} from '../../src/llms/scenario-router'
import { clearProviderExhaustion } from '../../src/services/failover-state'
import {
  __clearUsageCachesForTest,
  __seedClaudeCacheForTest,
  __seedCodexCacheForTest
} from '../../src/services/usage-service'
import type { ClaudeUsage, CodexUsage } from '../../src/schemas/usage.dto'

// A fixed clock: `now` sits exactly halfway through a window whose reset
// is half a window further out, so the linear drain target is 50%. Usage
// above 50 is over target; below 50 is under.
const SEVEN_DAY_MS = 7 * 86_400_000
const NOW = 1_000_000_000_000
const HALFWAY_RESET = NOW + SEVEN_DAY_MS / 2
const RESET_ISO = new Date(HALFWAY_RESET).toISOString()

// A no-op logger stub — the router only calls log.info, and the test does
// not assert on log output. Index 5 is the `log` param of the new
// applyProactiveFailover(primaryModel, scenarioType, isSubagent, tokenCount,
// config, log) signature.
const noopLog = {
  info() {},
  warn() {},
  error() {}
} as unknown as Parameters<typeof applyProactiveFailover>[5]

// A Claude snapshot with every weekly window driven explicitly so each
// test can place usage above/below the 50% drain target per window.
const makeClaude = (opts: { fiveHour: number; sevenDay: number; sevenDayOpus: number }): ClaudeUsage => ({
  accountLabel: 'acct',
  fiveHour: { utilization: opts.fiveHour, resetsAt: RESET_ISO },
  sevenDay: { utilization: opts.sevenDay, resetsAt: RESET_ISO },
  sevenDaySonnet: { utilization: 10, resetsAt: RESET_ISO },
  sevenDayOpus: { utilization: opts.sevenDayOpus, resetsAt: RESET_ISO },
  extraUsageEnabled: false,
  capturedAt: RESET_ISO
})

// A Codex snapshot with primary (short, soft) and secondary (weekly, hard)
// windows driven explicitly. windowSeconds matches each window's nominal
// length so the drain target lands at 50% at NOW.
const makeCodex = (opts: { primary: number; secondary: number }): CodexUsage => ({
  accountLabel: 'acct',
  planType: 'pro',
  primary: { usedPercent: opts.primary, resetAt: RESET_ISO, windowSeconds: 5 * 3600 },
  secondary: { usedPercent: opts.secondary, resetAt: RESET_ISO, windowSeconds: 7 * 86_400 },
  capturedAt: RESET_ISO
})

const claudeProvider = {
  name: 'anthropic',
  api_base_url: 'https://api.anthropic.com',
  auth_mode: 'subscription',
  models: ['claude-opus', 'claude-sonnet']
}
const codexProvider = {
  name: 'codex',
  api_base_url: 'https://chatgpt.com/backend-api',
  auth_mode: 'subscription',
  models: ['gpt-5']
}

beforeEach(() => {
  setSystemTime(new Date(NOW))
  __clearUsageCachesForTest()
  clearProviderExhaustion('anthropic')
  clearProviderExhaustion('codex')
})

afterEach(() => {
  setSystemTime()
  __clearUsageCachesForTest()
  clearProviderExhaustion('anthropic')
  clearProviderExhaustion('codex')
})

// ---- candidateUsable: weekly-window guard (S2) ---------------------

test('candidateUsable: a hot 5h window NEVER triggers failover (5h is soft)', () => {
  // 5h pegged at 100, but both weekly windows well under their 50% target.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 100, sevenDay: 20, sevenDayOpus: 20 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(true)
})

test('candidateUsable: claude is over limit when 7d-Opus is over its drain target', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
})

test('candidateUsable: claude is over limit when overall 7d is over its drain target', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 80, sevenDayOpus: 20 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
})

test('candidateUsable: claude stays usable when both weekly windows are under target', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 90, sevenDay: 40, sevenDayOpus: 40 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(true)
})

test('candidateUsable: over-limit claude is marked exhausted with the weekly reset', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
  setSystemTime(new Date(HALFWAY_RESET - 1000))
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
  setSystemTime(new Date(HALFWAY_RESET + 1000))
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(true)
})

test('candidateUsable: codex primary may burst; only secondary (weekly) triggers failover', () => {
  __seedCodexCacheForTest('c1', makeCodex({ primary: 100, secondary: 20 }), NOW)
  expect(candidateUsable('codex', [codexProvider])).toBe(true)
})

test('candidateUsable: codex is over limit when secondary is over its drain target', () => {
  __seedCodexCacheForTest('c1', makeCodex({ primary: 10, secondary: 80 }), NOW)
  expect(candidateUsable('codex', [codexProvider])).toBe(false)
})

test('candidateUsable: empty cache reads as usable (proactive only acts on real data)', () => {
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(true)
  expect(candidateUsable('codex', [codexProvider])).toBe(true)
})

test('candidateUsable: non-subscription providers are always usable', () => {
  const apiKeyProvider = { name: 'openai', auth_mode: 'api_key', models: ['gpt-4'] }
  expect(candidateUsable('openai', [apiKeyProvider])).toBe(true)
})

// ---- applyProactiveFailover: weekly guard + capability gate --------

// Build a ConfigStore whose flat Router carries an agent default primary
// plus the given agent fallback chain for the default scenario.
const routerWith = (fallbacks: string[]): ConfigStore =>
  new ConfigStore({
    Router: {
      agent: { default: 'anthropic,claude-opus' },
      agentFallbacks: { default: fallbacks }
    },
    providers: [claudeProvider, codexProvider]
  })

test('applyProactiveFailover: fails over to codex when claude weekly guard trips', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  __seedCodexCacheForTest('c1', makeCodex({ primary: 100, secondary: 20 }), NOW)
  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})

test('applyProactiveFailover: keeps the primary when it still has weekly headroom', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 100, sevenDay: 30, sevenDayOpus: 30 }), NOW)
  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, noopLog)
  expect(out).toBe('anthropic,claude-opus')
})

// ---- capability gate (contextWindow) -------------------------------

test('applyProactiveFailover: skips a candidate whose model cannot fit the request', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const config = new ConfigStore({
    Router: {
      agent: { default: 'anthropic,claude-opus' },
      agentFallbacks: { default: ['codex,gpt-5', 'codex,gpt-5-big'] }
    },
    providers: [
      claudeProvider,
      { ...codexProvider, models: ['gpt-5', 'gpt-5-big'], modelContextWindows: { 'gpt-5': 8000, 'gpt-5-big': 200000 } }
    ]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 9000, config, noopLog)
  expect(out).toBe('codex,gpt-5-big')
})

test('applyProactiveFailover: a candidate fits when the request is within its declared window', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const config = new ConfigStore({
    Router: { agent: { default: 'anthropic,claude-opus' }, agentFallbacks: { default: ['codex,gpt-5'] } },
    providers: [claudeProvider, { ...codexProvider, modelContextWindows: { 'gpt-5': 8000 } }]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 7000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})

test('applyProactiveFailover: a model with no declared window is allowed (unknown = allow)', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 5_000_000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})

// ---- effort / tier grading (S0.5) ----------------------------------

test('isHeavyRequest: high/xhigh/max effort grades as heavy', () => {
  expect(isHeavyRequest({ model: 'claude-sonnet', output_config: { effort: 'high' } })).toBe(true)
  expect(isHeavyRequest({ model: 'claude-sonnet', output_config: { effort: 'xhigh' } })).toBe(true)
  expect(isHeavyRequest({ model: 'claude-sonnet', output_config: { effort: 'max' } })).toBe(true)
})

test('isHeavyRequest: low/medium effort grades as light even when the model is opus', () => {
  expect(isHeavyRequest({ model: 'claude-opus', output_config: { effort: 'low' } })).toBe(false)
  expect(isHeavyRequest({ model: 'claude-opus', output_config: { effort: 'medium' } })).toBe(false)
})

test('isHeavyRequest: tier fallback kicks in when effort is absent', () => {
  expect(isHeavyRequest({ model: 'claude-opus-4-5' })).toBe(true)
  expect(isHeavyRequest({ model: 'claude-sonnet-4-5' })).toBe(false)
  expect(isHeavyRequest({ model: 'claude-haiku-4-5' })).toBe(false)
  expect(isHeavyRequest({ model: 'gpt-5' })).toBe(false)
})

test('isHeavyRequest: an unparseable effort string falls through to tier', () => {
  expect(isHeavyRequest({ model: 'claude-opus', output_config: { effort: 'whatever' } })).toBe(true)
  expect(isHeavyRequest({ model: 'claude-sonnet', output_config: { effort: 'whatever' } })).toBe(false)
})

const log = noopLog as unknown as Logger
const makeReq = (body: Partial<RouterRequest['body']> & { model: string }): RouterRequest => ({
  body: body as RouterRequest['body'],
  log
})

// ---- selectModel: scenario classification (agent route) ------------

test('selectModel: heavy effort escalates a short request into the longContext lane', () => {
  const router = {
    agent: { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus', think: 'anthropic,claude-opus' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-future', output_config: { effort: 'high' } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'longContext', isSubagent: false })
})

test('selectModel: opus-tier requested model escalates to longContext when effort is absent', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-opus-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'longContext', isSubagent: false })
})

test('selectModel: low effort keeps an opus request on the default (Sonnet) lane', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-opus-4-5', output_config: { effort: 'low' } }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default', isSubagent: false })
})

test('selectModel: a sonnet request without heavy signals stays on default', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-sonnet-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default', isSubagent: false })
})

test('selectModel: thinking field wins over the effort/tier escalation', () => {
  const router = {
    agent: { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus', think: 'anthropic,claude-think' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-opus-4-5', thinking: { type: 'enabled', budget_tokens: 1000 } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-think', scenarioType: 'think', isSubagent: false })
})

test('selectModel: size-based longContext still wins when the request exceeds the threshold', () => {
  const router = {
    agent: { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus' },
    longContextThreshold: 60_000
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-future', output_config: { effort: 'low' } }),
    100_000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'longContext', isSubagent: false })
})

test('selectModel: an agent request routes to the scenario agent primary (haiku → background)', () => {
  // No subagent tag, so the agent route is used. A haiku model with a
  // configured background primary lands on the agent background model.
  const provider = { ...claudeProvider, models: ['claude-haiku-4-5'] }
  const router = { agent: { default: 'anthropic,claude-sonnet', background: 'anthropic,claude-bg' } }
  const config = new ConfigStore({ Router: router, providers: [provider] })
  const out = selectModel(makeReq({ model: 'claude-haiku-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-bg', scenarioType: 'background', isSubagent: false })
})

test('selectModel: heavy escalation no-ops when the agent longContext route is unset', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-opus-4-5', output_config: { effort: 'high' } }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default', isSubagent: false })
})

// ---- selectModel: subagent route (tag presence, not value) ---------

test('selectModel: a <CCR-SUBAGENT-MODEL> tag selects the subagent route (value ignored, tag stripped)', () => {
  // The tag PRESENCE picks the scenario's subagent primary; the tag VALUE
  // (anthropic,claude-fable) is NOT used to route. The tag is stripped so
  // the marker never leaks upstream.
  const router = {
    agent: { default: 'anthropic,claude-agent' },
    subagent: { default: 'anthropic,claude-subagent' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const req = makeReq({
    model: 'claude-sonnet-4-5',
    system: [
      { type: 'text', text: 'You are a subagent.' },
      { type: 'text', text: '<CCR-SUBAGENT-MODEL>anthropic,claude-fable</CCR-SUBAGENT-MODEL>' }
    ]
  })
  const out = selectModel(req, 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-subagent', scenarioType: 'default', isSubagent: true })
  // Tag stripped from the outgoing system prompt.
  const system = req.body.system as { text: string }[]
  expect(system[1].text).toBe('')
})

test('selectModel: the subagent route classifies scenarios independently of the agent route', () => {
  // A subagent request with heavy effort escalates to the subagent
  // longContext primary — the agent longContext primary is not consulted.
  const router = {
    agent: { default: 'anthropic,claude-agent', longContext: 'anthropic,claude-agent-opus' },
    subagent: { default: 'anthropic,claude-sub', longContext: 'anthropic,claude-sub-opus' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({
      model: 'claude-opus-4-5',
      output_config: { effort: 'high' },
      system: [
        { type: 'text', text: 'sys' },
        { type: 'text', text: '<CCR-SUBAGENT-MODEL>x,y</CCR-SUBAGENT-MODEL>' }
      ]
    }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-sub-opus', scenarioType: 'longContext', isSubagent: true })
})

// ---- selectModel: chosen route primary null → req.body.model -------

test('selectModel: falls back to the request model when the chosen agent route has no primary', () => {
  // The agent route has no default primary configured, so the request's
  // own model is used verbatim (scenario default).
  const router = { agent: {} }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-sonnet-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'claude-sonnet-4-5', scenarioType: 'default', isSubagent: false })
})

test('selectModel: falls back to the request model when the chosen subagent route has no primary', () => {
  // Tag present → subagent route, but no subagent primary configured, so
  // the request's own model is used verbatim.
  const router = { agent: { default: 'anthropic,claude-agent' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({
      model: 'claude-sonnet-4-5',
      system: [
        { type: 'text', text: 'sys' },
        { type: 'text', text: '<CCR-SUBAGENT-MODEL>x,y</CCR-SUBAGENT-MODEL>' }
      ]
    }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'claude-sonnet-4-5', scenarioType: 'default', isSubagent: true })
})

// ---- applyProactiveFailover: chosen route's fallback chain ----------

test('applyProactiveFailover: an agent request walks the agent fallback chain', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const config = new ConfigStore({
    Router: {
      agent: { default: 'anthropic,claude-opus' },
      agentFallbacks: { default: ['codex,gpt-5-agent'] },
      subagentFallbacks: { default: ['codex,gpt-5-sub'] }
    },
    providers: [claudeProvider, { ...codexProvider, models: ['gpt-5-agent', 'gpt-5-sub'] }]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, noopLog)
  expect(out).toBe('codex,gpt-5-agent')
})

test('applyProactiveFailover: a subagent request walks the subagent fallback chain', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const config = new ConfigStore({
    Router: {
      agent: { default: 'anthropic,claude-opus' },
      agentFallbacks: { default: ['codex,gpt-5-agent'] },
      subagentFallbacks: { default: ['codex,gpt-5-sub'] }
    },
    providers: [claudeProvider, { ...codexProvider, models: ['gpt-5-agent', 'gpt-5-sub'] }]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', true, 1000, config, noopLog)
  expect(out).toBe('codex,gpt-5-sub')
})

// ---- weeklyDrainMarginPct (S5) -------------------------------------

test('candidateUsable: a positive marginPct lets usage run hot before the guard trips', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 60 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider], 20)).toBe(true)
})

test('candidateUsable: a positive marginPct still trips once usage clears target+margin', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider], 20)).toBe(false)
})

test('applyProactiveFailover: reads Router.weeklyDrainMarginPct and applies it to the guard', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 60 }), NOW)
  const config = new ConfigStore({
    Router: {
      agent: { default: 'anthropic,claude-opus' },
      agentFallbacks: { default: ['codex,gpt-5'] },
      weeklyDrainMarginPct: 20
    },
    providers: [claudeProvider, codexProvider]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, noopLog)
  expect(out).toBe('anthropic,claude-opus')
})

test('applyProactiveFailover: margin in config is ignored at 0 (back-compat with pre-S5)', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 60 }), NOW)
  const config = new ConfigStore({
    Router: { agent: { default: 'anthropic,claude-opus' }, agentFallbacks: { default: ['codex,gpt-5'] } },
    providers: [claudeProvider, codexProvider]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})

// ---- regression / chain decision (S6) ------------------------------

test('applyProactiveFailover: keeps the primary when every candidate is rejected', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  __seedCodexCacheForTest('c1', makeCodex({ primary: 10, secondary: 80 }), NOW)
  const captured: { msg: string; obj: Record<string, unknown> }[] = []
  const log = {
    info: (obj: Record<string, unknown>, msg: string) => captured.push({ msg, obj }),
    warn: (obj: Record<string, unknown>, msg: string) => captured.push({ msg, obj }),
    error: () => {}
  } as unknown as Parameters<typeof applyProactiveFailover>[5]

  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, log)

  expect(out).toBe('anthropic,claude-opus')
  const warn = captured.find((c) => c.msg.includes('all candidates rejected'))
  expect(warn).toBeDefined()
  const trace = warn?.obj.trace as { candidate: string; reason: string }[]
  expect(trace).toEqual([
    { candidate: 'anthropic,claude-opus', reason: 'rate-limited' },
    { candidate: 'codex,gpt-5', reason: 'rate-limited' }
  ])
})

test('applyProactiveFailover: a hot 5h window does NOT trigger the dead-chain warn (5h is soft)', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 95, sevenDay: 20, sevenDayOpus: 20 }), NOW)
  const captured: string[] = []
  const log = {
    info: (_: unknown, msg: string) => captured.push(msg),
    warn: (_: unknown, msg: string) => captured.push(msg),
    error: () => {}
  } as unknown as Parameters<typeof applyProactiveFailover>[5]

  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, log)
  expect(out).toBe('anthropic,claude-opus')
  expect(captured.some((m) => m.includes('all candidates rejected'))).toBe(false)
  expect(captured.some((m) => m.includes('proactive failover'))).toBe(false)
})

test('applyProactiveFailover: trace records the chain walk on a successful fail-over', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const captured: { msg: string; obj: Record<string, unknown> }[] = []
  const log = {
    info: (obj: Record<string, unknown>, msg: string) => captured.push({ msg, obj }),
    warn: (obj: Record<string, unknown>, msg: string) => captured.push({ msg, obj }),
    error: () => {}
  } as unknown as Parameters<typeof applyProactiveFailover>[5]

  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', false, 1000, config, log)
  expect(out).toBe('codex,gpt-5')
  const info = captured.find((c) => c.msg.includes('primary near rate limit'))
  const trace = info?.obj.trace as { candidate: string; reason: string }[]
  expect(trace).toEqual([
    { candidate: 'anthropic,claude-opus', reason: 'rate-limited' },
    { candidate: 'codex,gpt-5', reason: 'kept' }
  ])
})

test('applyProactiveFailover: capability-gate skips are recorded in the trace', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 20 }), NOW)
  const captured: { msg: string; obj: Record<string, unknown> }[] = []
  const log = {
    info: (obj: Record<string, unknown>, msg: string) => captured.push({ msg, obj }),
    warn: (obj: Record<string, unknown>, msg: string) => captured.push({ msg, obj }),
    error: () => {}
  } as unknown as Parameters<typeof applyProactiveFailover>[5]

  const config = new ConfigStore({
    Router: { agent: { default: 'codex,small' }, agentFallbacks: { default: ['codex,big'] } },
    providers: [{ ...codexProvider, models: ['small', 'big'], modelContextWindows: { small: 1000, big: 200_000 } }]
  })
  const out = applyProactiveFailover('codex,small', 'default', false, 5_000, config, log)
  expect(out).toBe('codex,big')
  const info = captured.find((c) => c.msg.includes('primary near rate limit'))
  const trace = info?.obj.trace as { candidate: string; reason: string }[]
  expect(trace).toEqual([
    { candidate: 'codex,small', reason: 'capability' },
    { candidate: 'codex,big', reason: 'kept' }
  ])
})

// ---- selectModel: webSearch lane -----------------------------------

test('selectModel: a web_search tool routes to the webSearch lane', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet', webSearch: 'anthropic,claude-search' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-4-5', tools: [{ type: 'web_search_20250305' }] }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-search', scenarioType: 'webSearch', isSubagent: false })
})

test('selectModel: webSearch wins over thinking when both are present', () => {
  const router = {
    agent: {
      default: 'anthropic,claude-sonnet',
      webSearch: 'anthropic,claude-search',
      think: 'anthropic,claude-think'
    }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({
      model: 'claude-sonnet-4-5',
      tools: [{ type: 'web_search_20250305' }],
      thinking: { type: 'enabled', budget_tokens: 1000 }
    }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-search', scenarioType: 'webSearch', isSubagent: false })
})

// ---- selectModel: unconfigured lanes fall through to default -------

test('selectModel: a web_search tool falls through to default when the webSearch route is unset', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-4-5', tools: [{ type: 'web_search_20250305' }] }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default', isSubagent: false })
})

test('selectModel: thinking falls through to default when the think route is unset', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-4-5', thinking: { type: 'enabled', budget_tokens: 1000 } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default', isSubagent: false })
})

test('selectModel: a haiku model falls through to default when the background route is unset', () => {
  const provider = { ...claudeProvider, models: ['claude-haiku-4-5'] }
  const router = { agent: { default: 'anthropic,claude-sonnet' } }
  const config = new ConfigStore({ Router: router, providers: [provider] })
  const out = selectModel(makeReq({ model: 'claude-haiku-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default', isSubagent: false })
})

test('selectModel: an oversized request falls through to default when the longContext route is unset', () => {
  const router = { agent: { default: 'anthropic,claude-sonnet' }, longContextThreshold: 60_000 }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-sonnet-4-5' }), 100_000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default', isSubagent: false })
})

// ---- selectModel: scenario precedence ------------------------------

test('selectModel: size-based longContext wins over haiku→background', () => {
  const provider = { ...claudeProvider, models: ['claude-haiku-4-5'] }
  const router = {
    agent: {
      default: 'anthropic,claude-sonnet',
      longContext: 'anthropic,claude-opus',
      background: 'anthropic,claude-bg'
    },
    longContextThreshold: 60_000
  }
  const config = new ConfigStore({ Router: router, providers: [provider] })
  const out = selectModel(makeReq({ model: 'claude-haiku-4-5' }), 100_000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'longContext', isSubagent: false })
})

test('selectModel: background wins over thinking for a haiku request', () => {
  const provider = { ...claudeProvider, models: ['claude-haiku-4-5'] }
  const router = {
    agent: {
      default: 'anthropic,claude-sonnet',
      background: 'anthropic,claude-bg',
      think: 'anthropic,claude-think'
    }
  }
  const config = new ConfigStore({ Router: router, providers: [provider] })
  const out = selectModel(
    makeReq({ model: 'claude-haiku-4-5', thinking: { type: 'enabled', budget_tokens: 1000 } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-bg', scenarioType: 'background', isSubagent: false })
})

// ---- selectModel: configured = override (Force), unset = passthrough

test('selectModel: a configured primary overrides the request model (Force behavior)', () => {
  // The request asks for one model; the default lane is configured to
  // another. Routing uses the configured primary and ignores req.body.model.
  const router = { agent: { default: 'anthropic,claude-opus' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'someprovider,somemodel' }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'default', isSubagent: false })
})

test('selectModel: an empty-string primary is treated as unset (request model passthrough)', () => {
  const router = { agent: { default: '' } }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-sonnet-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'claude-sonnet-4-5', scenarioType: 'default', isSubagent: false })
})

test('selectModel: an undefined router routes to default with the request model passthrough', () => {
  const config = new ConfigStore({ Router: {}, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-sonnet-4-5' }), 1000, undefined, config)
  expect(out).toEqual({ model: 'claude-sonnet-4-5', scenarioType: 'default', isSubagent: false })
})

// ---- selectModel: subagent-tag boundary cases ----------------------

test('selectModel: an unclosed subagent tag still selects the subagent route (present, not stripped)', () => {
  const router = {
    agent: { default: 'anthropic,claude-agent' },
    subagent: { default: 'anthropic,claude-sub' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const req = makeReq({
    model: 'claude-sonnet-4-5',
    system: [
      { type: 'text', text: 'sys' },
      { type: 'text', text: '<CCR-SUBAGENT-MODEL>anthropic,x' }
    ]
  })
  const out = selectModel(req, 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-sub', scenarioType: 'default', isSubagent: true })
  // Unclosed tag is left untouched (only a well-formed tag is stripped).
  const system = req.body.system as { text: string }[]
  expect(system[1].text).toBe('<CCR-SUBAGENT-MODEL>anthropic,x')
})

test('selectModel: a tag outside the second system block is ignored (agent route)', () => {
  const router = {
    agent: { default: 'anthropic,claude-agent' },
    subagent: { default: 'anthropic,claude-sub' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const req = makeReq({
    model: 'claude-sonnet-4-5',
    system: [
      { type: 'text', text: '<CCR-SUBAGENT-MODEL>x,y</CCR-SUBAGENT-MODEL>' },
      { type: 'text', text: 'sys' }
    ]
  })
  const out = selectModel(req, 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-agent', scenarioType: 'default', isSubagent: false })
})

test('selectModel: a single-block system cannot carry the tag (agent route)', () => {
  const router = {
    agent: { default: 'anthropic,claude-agent' },
    subagent: { default: 'anthropic,claude-sub' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const req = makeReq({
    model: 'claude-sonnet-4-5',
    system: [{ type: 'text', text: '<CCR-SUBAGENT-MODEL>x,y</CCR-SUBAGENT-MODEL>' }]
  })
  const out = selectModel(req, 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-agent', scenarioType: 'default', isSubagent: false })
})

// ---- selectModel: subagent lane classifies independently -----------

test('selectModel: a subagent web_search request uses the subagent webSearch route', () => {
  const router = {
    agent: { default: 'anthropic,claude-agent', webSearch: 'anthropic,claude-agent-search' },
    subagent: { default: 'anthropic,claude-sub', webSearch: 'anthropic,claude-sub-search' }
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({
      model: 'claude-sonnet-4-5',
      tools: [{ type: 'web_search_20250305' }],
      system: [
        { type: 'text', text: 'sys' },
        { type: 'text', text: '<CCR-SUBAGENT-MODEL>x,y</CCR-SUBAGENT-MODEL>' }
      ]
    }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-sub-search', scenarioType: 'webSearch', isSubagent: true })
})

test('selectModel: an unset subagent lane falls through even when the agent lane for that scenario is set', () => {
  // background is configured for the AGENT route only. A haiku SUBAGENT
  // request finds no subagent background route, so background does not win —
  // it falls through to the subagent default.
  const provider = { ...claudeProvider, models: ['claude-haiku-4-5'] }
  const router = {
    agent: { default: 'anthropic,claude-agent', background: 'anthropic,claude-agent-bg' },
    subagent: { default: 'anthropic,claude-sub' }
  }
  const config = new ConfigStore({ Router: router, providers: [provider] })
  const out = selectModel(
    makeReq({
      model: 'claude-haiku-4-5',
      system: [
        { type: 'text', text: 'sys' },
        { type: 'text', text: '<CCR-SUBAGENT-MODEL>x,y</CCR-SUBAGENT-MODEL>' }
      ]
    }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-sub', scenarioType: 'default', isSubagent: true })
})
