/**
 * Scenario classification under the chain selector.
 *
 * `classifyScenario` will not land on a scenario nothing is configured to
 * serve — otherwise a heavy request with no `longContext` route drops
 * onto the caller's own model. "Configured" used to mean one thing: a
 * RouterSlot primary, which is the Rules editor's half of the screen.
 *
 * That made a chain-only install impossible: with the slots empty, every
 * request classified as `default`, and the think / longContext /
 * webSearch chains the operator had just written were never asked for.
 * The gate now accepts either source, and the chain's own default model
 * drives the longContext auto-threshold for the same reason.
 *
 * The rules path passes no chain at all, and these pin that it keeps the
 * old behaviour exactly — widening it there would route requests to a
 * lane the rules path cannot serve.
 */

import { expect, test } from 'bun:test'
import type { Logger } from 'pino'
import { chainRoutingOf } from '../../src/llms/quota-router/runtime'
import { ConfigStore } from '../../src/llms/registry/config'
import { type ChainRouting, type RouterRequest, selectModel } from '../../src/llms/scenario-router'
import type { RouterPreferenceEntry, RouterPreferenceProfile } from '../../src/schemas/domain'

const noopLog = { info() {}, warn() {}, error() {} } as unknown as Logger
const makeReq = (body: Partial<RouterRequest['body']> & { model: string }): RouterRequest => ({
  body: body as RouterRequest['body'],
  log: noopLog
})

const entry = (target: string, enabled = true): RouterPreferenceEntry => ({ priority: 1, target, enabled })

const emptyPair = () => ({ agent: [], subagent: [] })

// The subagent marker is only read from the SECOND system block, which is
// where Claude Code puts it.
const subagentSystem = () => [
  { type: 'text', text: 'preamble' },
  { type: 'text', text: '<RIALTO-SUBAGENT-MODEL>x</RIALTO-SUBAGENT-MODEL>' }
]

// A profile carrying entries on just the lanes a test names. Everything
// else stays empty, which is the shape a partially-configured install has.
const profileWith = (lanes: Partial<Record<string, RouterPreferenceEntry[]>>): RouterPreferenceProfile => {
  const pair = (scenario: string) => ({
    agent: lanes[`${scenario}.agent`] === undefined ? [] : lanes[`${scenario}.agent`],
    subagent: lanes[`${scenario}.subagent`] === undefined ? [] : lanes[`${scenario}.subagent`]
  })
  return {
    entriesByScenario: {
      default: pair('default'),
      think: pair('think'),
      longContext: pair('longContext'),
      webSearch: pair('webSearch'),
      image: pair('image')
    },
    constraints: null
  }
}

const anthropic = {
  name: 'anthropic',
  api_base_url: 'https://api.anthropic.com',
  auth_mode: 'subscription',
  models: ['claude-opus', 'claude-sonnet', 'claude-think'],
  modelContextWindows: { 'claude-sonnet': 200_000 }
}

// The slots the chain-only operator left empty: a default primary only,
// because that is the one the seed writes.
const slotsWithDefaultOnly = { agent: { default: 'anthropic,claude-sonnet' } }
const config = () => new ConfigStore({ Router: slotsWithDefaultOnly, providers: [anthropic] })

// ---- the gate itself -----------------------------------------------

test('classification: a chain lane makes `think` reachable with no RouterSlot think primary', () => {
  const chain = chainRoutingOf(profileWith({ 'think.agent': [entry('anthropic,claude-think')] }), [anthropic])
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-4-5', thinking: { type: 'enabled', budget_tokens: 1000 } }),
    1000,
    slotsWithDefaultOnly,
    config(),
    chain
  )
  expect(out.scenarioType).toBe('think')
})

test('classification: without the chain (rules path) the same config still lands on default', () => {
  // The regression guard in the other direction: under the rules
  // selector nothing serves `think`, so classifying into it would drop
  // the request onto the caller's own model instead of the default
  // primary.
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-4-5', thinking: { type: 'enabled', budget_tokens: 1000 } }),
    1000,
    slotsWithDefaultOnly,
    config()
  )
  expect(out.scenarioType).toBe('default')
  expect(out.model).toBe('anthropic,claude-sonnet')
})

test('classification: a chain lane reaches webSearch and longContext too', () => {
  const chain = chainRoutingOf(
    profileWith({
      'webSearch.agent': [entry('anthropic,claude-sonnet')],
      'longContext.agent': [entry('anthropic,claude-opus')]
    }),
    [anthropic]
  )
  const search = selectModel(
    makeReq({ model: 'claude-sonnet-4-5', tools: [{ type: 'web_search_20250305', name: 'web_search' }] }),
    1000,
    slotsWithDefaultOnly,
    config(),
    chain
  )
  expect(search.scenarioType).toBe('webSearch')

  const heavy = selectModel(makeReq({ model: 'claude-opus-4-5' }), 1000, slotsWithDefaultOnly, config(), chain)
  expect(heavy.scenarioType).toBe('longContext')
})

test('classification: the subagent lane is gated independently of the agent lane', () => {
  // A chain that fills only the agent think lane must not make the
  // subagent think lane reachable — the two chains are ordered (and
  // configured) separately, and the selector would find nothing.
  const chain = chainRoutingOf(profileWith({ 'think.agent': [entry('anthropic,claude-think')] }), [anthropic])
  const out = selectModel(
    makeReq({
      model: 'claude-sonnet-4-5',
      system: subagentSystem(),
      thinking: { type: 'enabled', budget_tokens: 1000 }
    }),
    1000,
    slotsWithDefaultOnly,
    config(),
    chain
  )
  expect(out.isSubagent).toBe(true)
  expect(out.scenarioType).toBe('default')
})

test('classification: a RouterSlot primary still counts on its own', () => {
  // Nothing about the widening removes the original source: an install
  // with slots configured and no chain keeps classifying exactly as it did.
  const slots = { agent: { default: 'anthropic,claude-sonnet', think: 'anthropic,claude-think' } }
  const chain = chainRoutingOf(profileWith({}), [anthropic])
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-4-5', thinking: { type: 'enabled', budget_tokens: 1000 } }),
    1000,
    slots,
    new ConfigStore({ Router: slots, providers: [anthropic] }),
    chain
  )
  expect(out.scenarioType).toBe('think')
  expect(out.model).toBe('anthropic,claude-think')
})

// ---- chainRoutingOf ------------------------------------------------

test('chainRoutingOf: a lane whose entries are all soft-disabled does not count as configured', () => {
  // The selector skips disabled entries, so such a lane resolves to no
  // primary — classifying into it is the failure the gate prevents.
  const chain = chainRoutingOf(profileWith({ 'think.agent': [entry('anthropic,claude-think', false)] }), [anthropic])
  expect(chain.hasLane('agent', 'think')).toBe(false)
})

test('chainRoutingOf: the default lane’s top enabled target supplies the auto-threshold window', () => {
  const chain = chainRoutingOf(profileWith({ 'default.agent': [entry('anthropic,claude-sonnet')] }), [anthropic])
  expect(chain.defaultAgentContextWindow).toBe(200_000)
})

test('chainRoutingOf: an unscraped or unknown target leaves the window null', () => {
  const unknownModel = chainRoutingOf(profileWith({ 'default.agent': [entry('anthropic,claude-opus')] }), [anthropic])
  expect(unknownModel.defaultAgentContextWindow).toBeNull()

  const unknownProvider = chainRoutingOf(profileWith({ 'default.agent': [entry('nope,claude-sonnet')] }), [anthropic])
  expect(unknownProvider.defaultAgentContextWindow).toBeNull()

  const malformed = chainRoutingOf(profileWith({ 'default.agent': [entry('claude-sonnet')] }), [anthropic])
  expect(malformed.defaultAgentContextWindow).toBeNull()
})

test('chainRoutingOf: an empty profile is the same answer as no chain at all', () => {
  const chain = chainRoutingOf({ entriesByScenario: { ...emptyProfileScenarios() }, constraints: null }, [anthropic])
  expect(chain.hasLane('agent', 'think')).toBe(false)
  expect(chain.hasLane('subagent', 'longContext')).toBe(false)
  expect(chain.defaultAgentContextWindow).toBeNull()
})

function emptyProfileScenarios() {
  return {
    default: emptyPair(),
    think: emptyPair(),
    longContext: emptyPair(),
    webSearch: emptyPair(),
    image: emptyPair()
  }
}

// ---- the longContext auto-threshold --------------------------------

test('threshold: the chain’s default model drives the auto-threshold, not the 128k fallback', () => {
  // Chain-only install: no slot primary means `defaultAgentContextWindow`
  // on the flat router is null, which used to pin the threshold at the
  // historical 128k regardless of the model actually serving the lane.
  // 200k × 0.7 = 140k, so 130k must stay on `default`.
  const slots = { longContextThreshold: null }
  const chain: ChainRouting = chainRoutingOf(
    profileWith({
      'default.agent': [entry('anthropic,claude-sonnet')],
      'longContext.agent': [entry('anthropic,claude-opus')]
    }),
    [anthropic]
  )
  const store = new ConfigStore({ Router: slots, providers: [anthropic] })
  const under = selectModel(
    makeReq({ model: 'claude-sonnet-future', output_config: { effort: 'low' } }),
    130_000,
    slots,
    store,
    chain
  )
  expect(under.scenarioType).toBe('default')

  const over = selectModel(
    makeReq({ model: 'claude-sonnet-future', output_config: { effort: 'low' } }),
    141_000,
    slots,
    store,
    chain
  )
  expect(over.scenarioType).toBe('longContext')
})

test('threshold: an explicit longContextThreshold still wins over the chain’s window', () => {
  const slots = { longContextThreshold: 60_000 }
  const chain = chainRoutingOf(
    profileWith({
      'default.agent': [entry('anthropic,claude-sonnet')],
      'longContext.agent': [entry('anthropic,claude-opus')]
    }),
    [anthropic]
  )
  const out = selectModel(
    makeReq({ model: 'claude-sonnet-future', output_config: { effort: 'low' } }),
    70_000,
    slots,
    new ConfigStore({ Router: slots, providers: [anthropic] }),
    chain
  )
  expect(out.scenarioType).toBe('longContext')
})
