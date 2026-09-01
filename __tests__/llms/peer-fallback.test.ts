import { expect, test } from 'bun:test'
import { expandChainWithPeers, type HealthinessLookup } from '../../src/llms/scenario-router/peer-fallback'
import type { ConfigProvider } from '../../src/llms/scenario-router/types'

// Neutral healthiness lookup: every target scores 0.5 unless the test
// overrides it. Peer ordering then reduces to insertion order, so the
// tests can assert on peer *inclusion* separately from the ordering
// tests further down.
const neutralLookup: HealthinessLookup = () => 0.5

// Shared provider fixture. Two OpenAI-family providers offering the
// same model (`gpt-5.6-luna`), one Anthropic subscription that also
// declares the same string as a model name (should be excluded from
// peer expansion because its api_style is `anthropic`, not OpenAI-family).
const openaiProvider: ConfigProvider = {
  name: 'openai',
  api_base_url: 'https://api.openai.com/v1',
  api_key: 'sk-openai',
  auth_mode: 'api_key',
  api_style: 'openai_chat',
  models: ['gpt-5.6-luna', 'gpt-5.5']
}
const codexProvider: ConfigProvider = {
  name: 'codex',
  api_base_url: 'https://chatgpt.com/backend-api',
  api_key: 'oauth',
  auth_mode: 'subscription',
  api_style: 'openai_responses',
  models: ['gpt-5.6-luna', 'gpt-5.3-codex']
}
const anthropicProvider: ConfigProvider = {
  name: 'anthropic',
  api_base_url: 'https://api.anthropic.com',
  api_key: 'oauth',
  auth_mode: 'subscription',
  api_style: 'anthropic',
  models: ['gpt-5.6-luna', 'claude-opus']
}

test('expandChainWithPeers: disabled → chain unchanged, no peers added', () => {
  const out = expandChainWithPeers(
    'codex,gpt-5.6-luna',
    ['openrouter,mistral'],
    [openaiProvider, codexProvider, anthropicProvider],
    neutralLookup,
    false
  )
  expect(out.chain).toEqual(['codex,gpt-5.6-luna', 'openrouter,mistral'])
  expect(out.peerTargets.size).toBe(0)
})

test('expandChainWithPeers: enabled → injects OpenAI-family peer after primary', () => {
  const out = expandChainWithPeers(
    'codex,gpt-5.6-luna',
    [],
    [openaiProvider, codexProvider, anthropicProvider],
    neutralLookup,
    true
  )
  expect(out.chain).toEqual(['codex,gpt-5.6-luna', 'openai,gpt-5.6-luna'])
  expect(out.peerTargets.has('openai,gpt-5.6-luna')).toBe(true)
  expect(out.peerTargets.has('codex,gpt-5.6-luna')).toBe(false)
})

test('expandChainWithPeers: Anthropic provider with same model name is NOT picked as peer', () => {
  const out = expandChainWithPeers(
    'codex,gpt-5.6-luna',
    [],
    [openaiProvider, codexProvider, anthropicProvider],
    neutralLookup,
    true
  )
  // anthropic,gpt-5.6-luna is a syntactic same-name match but its
  // api_style is 'anthropic' — the expander must skip it.
  expect(out.chain).not.toContain('anthropic,gpt-5.6-luna')
})

test('expandChainWithPeers: Anthropic primary does NOT pull in OpenAI-family peers', () => {
  const out = expandChainWithPeers(
    'anthropic,gpt-5.6-luna',
    [],
    [openaiProvider, codexProvider, anthropicProvider],
    neutralLookup,
    true
  )
  expect(out.chain).toEqual(['anthropic,gpt-5.6-luna'])
  expect(out.peerTargets.size).toBe(0)
})

test('expandChainWithPeers: explicit fallback takes precedence over auto-injected peer', () => {
  // The user hand-configured openai,gpt-5.6-luna as an explicit fallback;
  // the expander must NOT duplicate it, and the user's spot in the chain
  // is respected — auto-injected peers slot in after the primary only if
  // they aren't already in the explicit chain.
  const out = expandChainWithPeers(
    'codex,gpt-5.6-luna',
    ['openai,gpt-5.6-luna'],
    [openaiProvider, codexProvider, anthropicProvider],
    neutralLookup,
    true
  )
  expect(out.chain).toEqual(['codex,gpt-5.6-luna', 'openai,gpt-5.6-luna'])
  // openai,gpt-5.6-luna was in the explicit chain, so it's NOT flagged as
  // peer-injected (auth_mode gate still applies to it).
  expect(out.peerTargets.has('openai,gpt-5.6-luna')).toBe(false)
})

test('expandChainWithPeers: peers ordered by healthiness score descending', () => {
  const groqProvider: ConfigProvider = {
    name: 'groq',
    api_base_url: 'https://api.groq.com/openai/v1',
    api_key: 'gsk',
    auth_mode: 'api_key',
    api_style: 'openai_chat',
    models: ['gpt-5.6-luna']
  }
  const openrouterProvider: ConfigProvider = {
    name: 'openrouter',
    api_base_url: 'https://openrouter.ai/api/v1',
    api_key: 'or',
    auth_mode: 'api_key',
    api_style: 'openai_chat',
    models: ['gpt-5.6-luna']
  }
  const lookup: HealthinessLookup = (t) => {
    if (t === 'openai,gpt-5.6-luna') return 0.9
    if (t === 'openrouter,gpt-5.6-luna') return 0.3
    if (t === 'groq,gpt-5.6-luna') return 0.6
    return undefined
  }
  const out = expandChainWithPeers(
    'codex,gpt-5.6-luna',
    [],
    [openaiProvider, codexProvider, groqProvider, openrouterProvider],
    lookup,
    true
  )
  // codex primary, then peers descending: openai(0.9) > groq(0.6) > openrouter(0.3).
  expect(out.chain).toEqual([
    'codex,gpt-5.6-luna',
    'openai,gpt-5.6-luna',
    'groq,gpt-5.6-luna',
    'openrouter,gpt-5.6-luna'
  ])
})

test('expandChainWithPeers: per-model apiStyle override wins over provider default', () => {
  // A single api_key `openai` provider hosts both openai_chat and
  // openai_responses models. When the primary is the codex-family model
  // whose per-model override is openai_responses, peers on other providers
  // that carry the same model name should still be picked up because
  // both sides are OpenAI-family.
  const openaiMixed: ConfigProvider = {
    name: 'openai',
    api_base_url: 'https://api.openai.com/v1',
    api_key: 'sk',
    auth_mode: 'api_key',
    api_style: 'openai_chat',
    modelApiStyles: { 'gpt-5.3-codex': 'openai_responses' },
    models: ['gpt-5.3-codex', 'gpt-5.6-luna']
  }
  const codexSubscription: ConfigProvider = {
    name: 'codex',
    api_base_url: 'https://chatgpt.com/backend-api',
    api_key: 'oauth',
    auth_mode: 'subscription',
    api_style: 'openai_responses',
    models: ['gpt-5.3-codex']
  }
  const out = expandChainWithPeers('codex,gpt-5.3-codex', [], [openaiMixed, codexSubscription], neutralLookup, true)
  expect(out.chain).toEqual(['codex,gpt-5.3-codex', 'openai,gpt-5.3-codex'])
  expect(out.peerTargets.has('openai,gpt-5.3-codex')).toBe(true)
})

test('expandChainWithPeers: no peers when model name is unique to the primary provider', () => {
  const out = expandChainWithPeers(
    'openai,gpt-5.5',
    [],
    [openaiProvider, codexProvider, anthropicProvider],
    neutralLookup,
    true
  )
  // gpt-5.5 is only on openai — no OpenAI-family peer exists.
  expect(out.chain).toEqual(['openai,gpt-5.5'])
  expect(out.peerTargets.size).toBe(0)
})

test('expandChainWithPeers: malformed chain entries are passed through unchanged', () => {
  const out = expandChainWithPeers(
    'malformed-no-comma',
    ['also-malformed'],
    [openaiProvider, codexProvider],
    neutralLookup,
    true
  )
  expect(out.chain).toEqual(['malformed-no-comma', 'also-malformed'])
  expect(out.peerTargets.size).toBe(0)
})

test('expandChainWithPeers: expands peers for EACH chain entry, not just the primary', () => {
  const groqProvider: ConfigProvider = {
    name: 'groq',
    api_base_url: 'https://api.groq.com/openai/v1',
    api_key: 'gsk',
    auth_mode: 'api_key',
    api_style: 'openai_chat',
    models: ['gpt-5.5']
  }
  const out = expandChainWithPeers(
    'codex,gpt-5.6-luna',
    ['openai,gpt-5.5'],
    [openaiProvider, codexProvider, groqProvider],
    neutralLookup,
    true
  )
  // codex primary → openai,gpt-5.6-luna peer; openai,gpt-5.5 fallback →
  // groq,gpt-5.5 peer (both OpenAI-family, same model name).
  expect(out.chain).toEqual(['codex,gpt-5.6-luna', 'openai,gpt-5.6-luna', 'openai,gpt-5.5', 'groq,gpt-5.5'])
})
