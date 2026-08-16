/**
 * buildModelRows — the flattener that feeds ModelsDashboard.
 *
 * Verifies the DB-driven behaviours the dashboard depends on:
 *
 *  - Providers without a usable credential (subscription with no plan,
 *    api_key with no key) are dropped entirely.
 *  - Deprecated models are excluded — the dashboard is a "what can I
 *    route to right now" view, not a catalog audit. Prior behaviour
 *    surfaced them with a badge; keeping the row would be regressive.
 *  - Legacy models (still-billed but on an older price sheet) DO stay
 *    in the list. Only deprecated is filtered.
 *  - Model.enabled reflects whether the model is on the disabled-list
 *    the transformer block carries.
 */

import { describe, expect, test } from 'bun:test'
import { buildModelRows } from '../../src/lib/models/build-rows'
import type { Provider } from '../../src/types'

const makeProvider = (overrides: Partial<Provider>): Provider =>
  ({
    name: 'openai',
    enabled: true,
    api_base_url: 'https://api.openai.com/v1/chat/completions',
    api_key: 'sk-x',
    auth_mode: 'api_key',
    models: [],
    ...overrides
  }) as Provider

describe('buildModelRows', () => {
  test('emits one row per model on a credentialed api_key provider', () => {
    const rows = buildModelRows(
      [
        makeProvider({
          models: ['gpt-5-nano', 'gpt-5-mini'],
          modelPrices: {
            'gpt-5-nano': { inputPer1M: 0.2, outputPer1M: 1.2 },
            'gpt-5-mini': { inputPer1M: 0.5, outputPer1M: 3 }
          }
        })
      ],
      {}
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.model)).toEqual(['gpt-5-nano', 'gpt-5-mini'])
    expect(rows[0].inputPer1M).toBe(0.2)
  })

  test('drops api_key providers with no key on file', () => {
    const rows = buildModelRows(
      [makeProvider({ api_key: '', models: ['x'] }), makeProvider({ api_key: '   ', models: ['y'] })],
      {}
    )
    expect(rows).toHaveLength(0)
  })

  test('drops subscription providers with no active plan', () => {
    const rows = buildModelRows(
      [
        makeProvider({
          name: 'claude-code',
          auth_mode: 'subscription',
          api_key: null as unknown as string,
          api_base_url: 'https://api.anthropic.com/v1/messages',
          models: ['claude-sonnet-5']
        })
      ],
      { 'claude-code': null }
    )
    expect(rows).toHaveLength(0)
  })

  test('keeps subscription providers with an active plan', () => {
    const rows = buildModelRows(
      [
        makeProvider({
          name: 'claude-code',
          auth_mode: 'subscription',
          api_key: null as unknown as string,
          api_base_url: 'https://api.anthropic.com/v1/messages',
          models: ['claude-sonnet-5']
        })
      ],
      { 'claude-code': 'claude_max' }
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].isSubscription).toBe(true)
  })

  test('drops deprecated models — dashboard is a "what can I route right now" view', () => {
    const rows = buildModelRows(
      [
        makeProvider({
          models: ['gpt-5-nano', 'gpt-3.5-turbo', 'gpt-4o-mini'],
          deprecatedModels: ['gpt-3.5-turbo']
        })
      ],
      {}
    )
    expect(rows.map((r) => r.model)).toEqual(['gpt-5-nano', 'gpt-4o-mini'])
  })

  test('deprecated filter is narrow — a legacy-priced model that is not deprecated stays', () => {
    // build-rows does not read `legacy`; it filters solely on the
    // deprecatedModels list. This test guards the boundary.
    const rows = buildModelRows(
      [
        makeProvider({
          models: ['legacy-model', 'current-model'],
          deprecatedModels: []
        })
      ],
      {}
    )
    expect(rows.map((r) => r.model)).toEqual(['legacy-model', 'current-model'])
  })

  test('Model.enabled reflects the transformer._disabledModels list', () => {
    const rows = buildModelRows(
      [
        makeProvider({
          models: ['a', 'b'],
          transformer: { _disabledModels: ['b'] } as unknown as Provider['transformer']
        })
      ],
      {}
    )
    expect(rows.find((r) => r.model === 'a')?.enabled).toBe(true)
    expect(rows.find((r) => r.model === 'b')?.enabled).toBe(false)
  })
})
