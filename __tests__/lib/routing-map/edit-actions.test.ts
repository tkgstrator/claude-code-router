import { expect, test } from 'bun:test'
import {
  addRule,
  connectModel,
  disconnectModel,
  emptyRule,
  moveFallback,
  moveRule,
  removeRule,
  updateRule
} from '../../../src/lib/routing-map/edit-actions'
import type { RouterConfig } from '../../../src/schemas/domain/router'

// A fully-unset nested RouterConfig the tests mutate field by field. Each
// scenario carries an agent + subagent route; the editor helpers edit the
// agent route only, so the assertions read `<scenario>.agent.*`. `rules`
// is empty in every route — predicated rules are populated by the migration
// (or a future rule editor) and are opaque to these editor helpers.
function emptyRoute(): { primary: string | null; fallbacks: string[]; rules: [] } {
  return { primary: null, fallbacks: [], rules: [] }
}
function baseRouter(): RouterConfig {
  return {
    default: { agent: emptyRoute(), subagent: emptyRoute() },
    think: { agent: emptyRoute(), subagent: emptyRoute() },
    longContext: { agent: emptyRoute(), subagent: emptyRoute(), threshold: 60000 },
    webSearch: { agent: emptyRoute(), subagent: emptyRoute() },
    image: { agent: emptyRoute(), subagent: emptyRoute() }
  }
}

test('connectModel sets the primary on an empty slot', () => {
  const r = connectModel(baseRouter(), 'default', 'openai,gpt-5', 'agent')
  expect(r.default.agent.primary).toBe('openai,gpt-5')
  expect(r.default.agent.fallbacks).toEqual([])
})

test('connectModel appends a fallback when the primary is set (different provider)', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5', 'agent')
  const r1 = connectModel(r0, 'default', 'anthropic,claude', 'agent')
  expect(r1.default.agent.primary).toBe('openai,gpt-5')
  expect(r1.default.agent.fallbacks).toEqual(['anthropic,claude'])
})

test('connectModel accepts a fallback on the primary provider (intra-account rescue)', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5', 'agent')
  const r1 = connectModel(r0, 'default', 'openai,gpt-5-nano', 'agent')
  expect(r1.default.agent.fallbacks).toEqual(['openai,gpt-5-nano'])
})

test('connectModel rejects a duplicate fallback and the primary itself', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5', 'agent')
  const r1 = connectModel(r0, 'default', 'anthropic,claude', 'agent')
  const r2 = connectModel(r1, 'default', 'anthropic,claude', 'agent')
  const r3 = connectModel(r2, 'default', 'openai,gpt-5', 'agent')
  expect(r3.default.agent.fallbacks).toEqual(['anthropic,claude'])
})

test('promoting a fallback to primary keeps sibling fallbacks intact', () => {
  // The old rule "setting a new primary drops fallbacks that share
  // its provider" no longer applies — same-provider is allowed.
  // Verify that the empty→primary transition just sets primary and
  // leaves the fallback chain unchanged.
  const r0 = connectModel(baseRouter(), 'default', 'anthropic,claude', 'agent')
  const r1 = connectModel(r0, 'default', 'openai,gpt-5', 'agent')
  expect(r1.default.agent.fallbacks).toEqual(['openai,gpt-5'])
  const r2 = disconnectModel(r1, 'default', 'anthropic,claude', 'agent')
  expect(r2.default.agent.primary).toBeNull()
  const r3 = connectModel(r2, 'default', 'openai,gpt-5-nano', 'agent')
  expect(r3.default.agent.primary).toBe('openai,gpt-5-nano')
  expect(r3.default.agent.fallbacks).toEqual(['openai,gpt-5'])
})

test('disconnectModel clears the primary or drops the fallback', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5', 'agent')
  const r1 = connectModel(r0, 'default', 'anthropic,claude', 'agent')
  expect(disconnectModel(r1, 'default', 'openai,gpt-5', 'agent').default.agent.primary).toBeNull()
  expect(disconnectModel(r1, 'default', 'anthropic,claude', 'agent').default.agent.fallbacks).toEqual([])
})

test('moveFallback reorders the chain and no-ops out of range', () => {
  const r0 = connectModel(baseRouter(), 'default', 'x,primary', 'agent')
  const r1 = connectModel(r0, 'default', 'a,one', 'agent')
  const r2 = connectModel(r1, 'default', 'b,two', 'agent')
  const r3 = connectModel(r2, 'default', 'c,three', 'agent')
  expect(moveFallback(r3, 'default', 0, 2, 'agent').default.agent.fallbacks).toEqual(['b,two', 'c,three', 'a,one'])
  expect(moveFallback(r3, 'default', 0, 5, 'agent').default.agent.fallbacks).toEqual(['a,one', 'b,two', 'c,three'])
})

test('editing the agent route leaves the subagent route untouched', () => {
  const r = connectModel(baseRouter(), 'default', 'openai,gpt-5', 'agent')
  expect(r.default.subagent).toEqual({ primary: null, fallbacks: [], rules: [] })
})

test('editing the subagent route leaves the agent route untouched', () => {
  const r0 = connectModel(baseRouter(), 'default', 'openai,gpt-5', 'subagent')
  const r1 = connectModel(r0, 'default', 'anthropic,claude', 'subagent')
  expect(r1.default.subagent.primary).toBe('openai,gpt-5')
  expect(r1.default.subagent.fallbacks).toEqual(['anthropic,claude'])
  expect(r1.default.agent).toEqual({ primary: null, fallbacks: [], rules: [] })
})

test('the same model can be wired into both kinds independently', () => {
  const r0 = connectModel(baseRouter(), 'webSearch', 'openai,gpt-5', 'agent')
  const r1 = connectModel(r0, 'webSearch', 'openai,gpt-5', 'subagent')
  expect(r1.webSearch.agent.primary).toBe('openai,gpt-5')
  expect(r1.webSearch.subagent.primary).toBe('openai,gpt-5')
  const r2 = disconnectModel(r1, 'webSearch', 'openai,gpt-5', 'agent')
  expect(r2.webSearch.agent.primary).toBeNull()
  expect(r2.webSearch.subagent.primary).toBe('openai,gpt-5')
})

// ── Route rules ───────────────────────────────────────────────────────

test('addRule appends to the rule stack on the chosen route', () => {
  const rule = { ...emptyRule(), name: 'haiku', when: { requestedTier: ['haiku'] as const } }
  const r = addRule(baseRouter(), 'default', 'agent', rule)
  expect(r.default.agent.rules).toEqual([rule])
  expect(r.default.subagent.rules).toEqual([])
})

test('updateRule replaces the rule at the given index and no-ops on OOB', () => {
  const a = { ...emptyRule(), name: 'a' }
  const b = { ...emptyRule(), name: 'b' }
  const r0 = addRule(addRule(baseRouter(), 'default', 'agent', a), 'default', 'agent', b)
  const replaced = { ...emptyRule(), name: 'a-updated' }
  const r1 = updateRule(r0, 'default', 'agent', 0, replaced)
  expect(r1.default.agent.rules[0].name).toBe('a-updated')
  expect(r1.default.agent.rules[1].name).toBe('b')
  // OOB is a no-op — returns the same router reference is not required,
  // but the shape must be unchanged.
  const r2 = updateRule(r0, 'default', 'agent', 42, replaced)
  expect(r2.default.agent.rules).toEqual(r0.default.agent.rules)
})

test('removeRule drops the rule at the given index', () => {
  const a = { ...emptyRule(), name: 'a' }
  const b = { ...emptyRule(), name: 'b' }
  const c = { ...emptyRule(), name: 'c' }
  const r0 = addRule(
    addRule(addRule(baseRouter(), 'default', 'agent', a), 'default', 'agent', b),
    'default',
    'agent',
    c
  )
  const r1 = removeRule(r0, 'default', 'agent', 1)
  expect(r1.default.agent.rules.map((r) => r.name)).toEqual(['a', 'c'])
})

test('moveRule reorders the stack and no-ops out of range', () => {
  const a = { ...emptyRule(), name: 'a' }
  const b = { ...emptyRule(), name: 'b' }
  const c = { ...emptyRule(), name: 'c' }
  const r0 = addRule(
    addRule(addRule(baseRouter(), 'default', 'agent', a), 'default', 'agent', b),
    'default',
    'agent',
    c
  )
  expect(moveRule(r0, 'default', 'agent', 0, 2).default.agent.rules.map((r) => r.name)).toEqual(['b', 'c', 'a'])
  expect(moveRule(r0, 'default', 'agent', 0, 5).default.agent.rules.map((r) => r.name)).toEqual(['a', 'b', 'c'])
})

test('rule mutations on agent leave subagent untouched (and vice versa)', () => {
  const rule = { ...emptyRule(), name: 'x' }
  const r = addRule(baseRouter(), 'default', 'agent', rule)
  expect(r.default.subagent.rules).toEqual([])
})
