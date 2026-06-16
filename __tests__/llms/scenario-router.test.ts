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
// not assert on log output.
const noopLog = {
  info() {},
  warn() {},
  error() {}
} as unknown as Parameters<typeof applyProactiveFailover>[4]

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
  // 7d Opus at 80 > 50 target; overall 7d under target.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
})

test('candidateUsable: claude is over limit when overall 7d is over its drain target', () => {
  // Overall 7d at 80 > 50 target; 7d Opus under target.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 80, sevenDayOpus: 20 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
})

test('candidateUsable: claude stays usable when both weekly windows are under target', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 90, sevenDay: 40, sevenDayOpus: 40 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(true)
})

test('candidateUsable: over-limit claude is marked exhausted with the weekly reset', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  // First read trips the guard and marks the provider exhausted ...
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
  // ... and the exhaustion holds until just before the weekly reset.
  setSystemTime(new Date(HALFWAY_RESET - 1000))
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(false)
  // After the reset the mark has expired (and usage now reads under the
  // 100% target since the window has fully elapsed), so it is usable again.
  setSystemTime(new Date(HALFWAY_RESET + 1000))
  expect(candidateUsable('anthropic', [claudeProvider])).toBe(true)
})

test('candidateUsable: codex primary may burst; only secondary (weekly) triggers failover', () => {
  // primary pegged at 100 (soft), secondary under its 50% target.
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

const routerWith = (fallbacks: string[]): ConfigStore =>
  new ConfigStore({
    Router: {
      default: 'anthropic,claude-opus',
      fallbacks: { default: fallbacks }
    },
    providers: [claudeProvider, codexProvider]
  })

test('applyProactiveFailover: fails over to codex when claude weekly guard trips', () => {
  // Claude over its weekly Opus target; codex healthy.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  __seedCodexCacheForTest('c1', makeCodex({ primary: 100, secondary: 20 }), NOW)
  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', 1000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})

test('applyProactiveFailover: keeps the primary when it still has weekly headroom', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 100, sevenDay: 30, sevenDayOpus: 30 }), NOW)
  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', 1000, config, noopLog)
  expect(out).toBe('anthropic,claude-opus')
})

// ---- capability gate (contextWindow) -------------------------------

test('applyProactiveFailover: skips a candidate whose model cannot fit the request', () => {
  // Claude weekly guard trips, so we want to fail over. The first fallback
  // (codex,gpt-5) has a declared 8k window but the request is 9k tokens —
  // it must be skipped in favour of the second fallback with a 200k window.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const config = new ConfigStore({
    Router: { default: 'anthropic,claude-opus', fallbacks: { default: ['codex,gpt-5', 'codex,gpt-5-big'] } },
    providers: [
      claudeProvider,
      { ...codexProvider, models: ['gpt-5', 'gpt-5-big'], modelContextWindows: { 'gpt-5': 8000, 'gpt-5-big': 200000 } }
    ]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', 9000, config, noopLog)
  expect(out).toBe('codex,gpt-5-big')
})

test('applyProactiveFailover: a candidate fits when the request is within its declared window', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  const config = new ConfigStore({
    Router: { default: 'anthropic,claude-opus', fallbacks: { default: ['codex,gpt-5'] } },
    providers: [claudeProvider, { ...codexProvider, modelContextWindows: { 'gpt-5': 8000 } }]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', 7000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})

test('applyProactiveFailover: a model with no declared window is allowed (unknown = allow)', () => {
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  // codex provider declares NO modelContextWindows, so even a huge request
  // is allowed onto it — the gate is conservative when the window is unknown.
  const config = routerWith(['codex,gpt-5'])
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', 5_000_000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})

// ---- effort / tier grading (S0.5) ----------------------------------

test('isHeavyRequest: high/xhigh/max effort grades as heavy', () => {
  expect(isHeavyRequest({ model: 'claude-sonnet', output_config: { effort: 'high' } })).toBe(true)
  expect(isHeavyRequest({ model: 'claude-sonnet', output_config: { effort: 'xhigh' } })).toBe(true)
  expect(isHeavyRequest({ model: 'claude-sonnet', output_config: { effort: 'max' } })).toBe(true)
})

test('isHeavyRequest: low/medium effort grades as light even when the model is opus', () => {
  // Explicit low/medium overrides the tier fallback so callers can
  // downgrade a Claude Code default opus request.
  expect(isHeavyRequest({ model: 'claude-opus', output_config: { effort: 'low' } })).toBe(false)
  expect(isHeavyRequest({ model: 'claude-opus', output_config: { effort: 'medium' } })).toBe(false)
})

test('isHeavyRequest: tier fallback kicks in when effort is absent', () => {
  // No effort field → fall through to the model name. Opus is heavy;
  // sonnet/haiku/unknown is light.
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

test('selectModel: heavy effort escalates a short request into the longContext lane', () => {
  const router = {
    default: 'anthropic,claude-sonnet',
    longContext: 'anthropic,claude-opus',
    think: 'anthropic,claude-opus'
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-sonnet', output_config: { effort: 'high' } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'longContext' })
})

test('selectModel: opus-tier requested model escalates to longContext when effort is absent', () => {
  const router = { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus' }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-opus-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'longContext' })
})

test('selectModel: low effort keeps an opus request on the default (Sonnet) lane', () => {
  const router = { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus' }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-opus-4-5', output_config: { effort: 'low' } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default' })
})

test('selectModel: a sonnet request without heavy signals stays on default', () => {
  const router = { default: 'anthropic,claude-sonnet', longContext: 'anthropic,claude-opus' }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(makeReq({ model: 'claude-sonnet-4-5' }), 1000, router, config)
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default' })
})

test('selectModel: thinking field wins over the effort/tier escalation', () => {
  // A request with thinking attached lands in the `think` lane even when
  // it would otherwise heavy-escalate to longContext. Think is the more
  // specific signal so it should take precedence.
  const router = {
    default: 'anthropic,claude-sonnet',
    longContext: 'anthropic,claude-opus',
    think: 'anthropic,claude-think'
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-opus-4-5', thinking: { type: 'enabled', budget_tokens: 1000 } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-think', scenarioType: 'think' })
})

test('selectModel: size-based longContext still wins when the request exceeds the threshold', () => {
  // pickLongContext runs before the effort escalation; a long but
  // low-effort request still goes through the size-based lane.
  const router = {
    default: 'anthropic,claude-sonnet',
    longContext: 'anthropic,claude-opus',
    longContextThreshold: 60_000
  }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-sonnet', output_config: { effort: 'low' } }),
    100_000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-opus', scenarioType: 'longContext' })
})

test('selectModel: heavy escalation no-ops when router.longContext is unset', () => {
  // No longContext lane configured — heavy requests fall through to
  // default rather than dropping the request.
  const router = { default: 'anthropic,claude-sonnet' }
  const config = new ConfigStore({ Router: router, providers: [claudeProvider] })
  const out = selectModel(
    makeReq({ model: 'claude-opus-4-5', output_config: { effort: 'high' } }),
    1000,
    router,
    config
  )
  expect(out).toEqual({ model: 'anthropic,claude-sonnet', scenarioType: 'default' })
})

// ---- weeklyDrainMarginPct (S5) -------------------------------------

test('candidateUsable: a positive marginPct lets usage run hot before the guard trips', () => {
  // 7d Opus at 60 — above the 50 linear target but below 50+20=70 with
  // a 20-point margin, so the guard should NOT trip.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 60 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider], 20)).toBe(true)
})

test('candidateUsable: a positive marginPct still trips once usage clears target+margin', () => {
  // 7d Opus at 80 > 50+20=70, so the guard should trip even with the
  // 20-point margin.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 80 }), NOW)
  expect(candidateUsable('anthropic', [claudeProvider], 20)).toBe(false)
})

test('applyProactiveFailover: reads Router.weeklyDrainMarginPct and applies it to the guard', () => {
  // 7d Opus at 60: above the 50 target, would trip without margin, but
  // a 20-point margin in the Router config keeps the primary usable.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 60 }), NOW)
  const config = new ConfigStore({
    Router: {
      default: 'anthropic,claude-opus',
      fallbacks: { default: ['codex,gpt-5'] },
      weeklyDrainMarginPct: 20
    },
    providers: [claudeProvider, codexProvider]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', 1000, config, noopLog)
  expect(out).toBe('anthropic,claude-opus')
})

test('applyProactiveFailover: margin in config is ignored at 0 (back-compat with pre-S5)', () => {
  // Identical setup to the test above but no margin in config — guard
  // trips at the linear target and we fail over.
  __seedClaudeCacheForTest('a1', makeClaude({ fiveHour: 10, sevenDay: 20, sevenDayOpus: 60 }), NOW)
  const config = new ConfigStore({
    Router: { default: 'anthropic,claude-opus', fallbacks: { default: ['codex,gpt-5'] } },
    providers: [claudeProvider, codexProvider]
  })
  const out = applyProactiveFailover('anthropic,claude-opus', 'default', 1000, config, noopLog)
  expect(out).toBe('codex,gpt-5')
})
