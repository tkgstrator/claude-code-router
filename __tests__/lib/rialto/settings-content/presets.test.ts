import { describe, expect, test } from 'bun:test'
import type { RequiredInput } from '../../../../src/lib/presets/types'
import {
  missingInputIds,
  presetCounts,
  presetDiff,
  seedInputs
} from '../../../../src/lib/rialto/settings-content/presets'
import type { Config } from '../../../../src/types'

const target = (primary: string | null) => ({ primary, fallbacks: [], rules: [] })
const scenario = (primary: string | null) => ({ agent: target(primary), subagent: target(null) })

const provider = (name: string, models: string[], authMode: 'api_key' | 'subscription' = 'api_key') => ({
  name,
  enabled: true,
  api_base_url: 'https://example.test/v1',
  api_key: null,
  auth_mode: authMode,
  models
})

// Only the two branches presetDiff reads are populated; the rest of the
// envelope is irrelevant to the diff and would just be noise here.
const makeConfig = (over: { providers?: ReturnType<typeof provider>[]; router?: Record<string, unknown> }): Config =>
  ({
    Providers: over.providers === undefined ? [] : over.providers,
    Router: {
      default: scenario('claude-code,claude-opus-4-8'),
      think: scenario(null),
      longContext: { ...scenario(null), threshold: null },
      webSearch: scenario(null),
      image: scenario(null),
      ...over.router
    }
  }) as unknown as Config

describe('presetCounts', () => {
  test('sums models across the preset providers', () => {
    expect(
      presetCounts({
        Providers: [
          { name: 'a', models: ['m1', 'm2'] },
          { name: 'b', models: ['m3'] }
        ]
      })
    ).toEqual({
      providers: 2,
      models: 3
    })
  })

  test('is zero for a preset that carries no providers', () => {
    expect(presetCounts(undefined)).toEqual({ providers: 0, models: 0 })
    expect(presetCounts({})).toEqual({ providers: 0, models: 0 })
  })
})

describe('presetDiff', () => {
  test('marks a provider the config does not have as an addition', () => {
    const rows = presetDiff({ Providers: [{ name: 'openai', models: ['gpt-5.5'] }] }, makeConfig({}))
    expect(rows).toEqual([
      { key: 'provider:openai', kind: 'add', label: 'provider', name: 'openai', from: null, to: null }
    ])
  })

  test('reports a model-count change for a provider already installed', () => {
    const rows = presetDiff(
      { Providers: [{ name: 'openai', models: ['gpt-5.5', 'gpt-5.4-mini'] }] },
      makeConfig({ providers: [provider('openai', ['gpt-5.5'])] })
    )
    expect(rows).toEqual([
      {
        key: 'provider:openai',
        kind: 'change',
        label: 'provider',
        name: 'openai',
        from: '1 models',
        to: '2 models'
      }
    ])
  })

  test('says nothing about a provider that already matches', () => {
    const rows = presetDiff(
      { Providers: [{ name: 'openai', models: ['gpt-5.5'] }] },
      makeConfig({ providers: [provider('openai', ['gpt-5.5'])] })
    )
    expect(rows).toEqual([])
  })

  test('reports a retargeted scenario, naming the route being replaced', () => {
    const rows = presetDiff({ Router: { default: 'openai,gpt-5.5' } }, makeConfig({}))
    expect(rows).toEqual([
      {
        key: 'router:default',
        kind: 'change',
        label: 'Router.default.agent',
        name: null,
        from: 'claude-code,claude-opus-4-8',
        to: 'openai,gpt-5.5'
      }
    ])
  })

  test('renders an unset scenario as (unset) rather than a blank', () => {
    const rows = presetDiff({ Router: { longContext: 'anthropic,claude-sonnet-4-6' } }, makeConfig({}))
    expect(rows[0].from).toBe('(unset)')
  })

  test('ignores a scenario key the router does not model', () => {
    expect(presetDiff({ Router: { background: 'openai,gpt-5.4-mini' } }, makeConfig({}))).toEqual([])
  })

  test('closes with the subscription providers a preset can never touch', () => {
    const rows = presetDiff(
      {},
      makeConfig({ providers: [provider('claude-code', ['claude-opus-4-8'], 'subscription')] })
    )
    expect(rows).toEqual([
      {
        key: 'subscriptions',
        kind: 'same',
        label: '1 subscription provider untouched',
        name: null,
        from: null,
        to: null
      }
    ])
  })
})

describe('seedInputs', () => {
  const schema: RequiredInput[] = [
    { id: 'apiKey', type: 'password', label: 'OpenAI API key' },
    { id: 'region', type: 'input', defaultValue: 'us' },
    { id: 'temperature', type: 'number', defaultValue: 0 }
  ]

  test('never seeds a password field, even when the server holds one', () => {
    const seeded = seedInputs(schema, { apiKey: 'sk-proj-secret', region: 'eu' })
    expect(seeded.values.apiKey).toBeUndefined()
    expect(seeded.storedIds).toEqual(['apiKey'])
  })

  test('prefers a saved value over the schema default', () => {
    expect(seedInputs(schema, { region: 'eu' }).values.region).toBe('eu')
  })

  test('falls back to the schema default, then to empty', () => {
    const seeded = seedInputs(schema, undefined)
    expect(seeded.values.region).toBe('us')
    expect(seeded.values.temperature).toBe(0)
    expect(seeded.storedIds).toEqual([])
  })
})

describe('missingInputIds', () => {
  const schema: RequiredInput[] = [
    { id: 'apiKey', type: 'password' },
    { id: 'note', type: 'input', required: false },
    { id: 'agree', type: 'confirm' }
  ]

  test('reports an unfilled required field', () => {
    expect(missingInputIds(schema, { agree: false })).toEqual(['apiKey'])
  })

  test('treats false as an answer for a confirm field', () => {
    expect(missingInputIds(schema, { apiKey: 'sk-x', agree: false })).toEqual([])
  })

  test('does not demand a secret the server already holds', () => {
    expect(missingInputIds(schema, { agree: true }, ['apiKey'])).toEqual([])
  })

  test('ignores optional fields', () => {
    expect(missingInputIds(schema, { apiKey: 'sk-x', agree: true, note: '' })).toEqual([])
  })
})
