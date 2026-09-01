import { expect, test } from 'bun:test'
import { buildRoutingGraph, SCENARIOS, UNTRACKED } from '../../../src/lib/routing-map/build-graph'

// Minimal RouterInput factory — every lane unset, no fallbacks — that tests
// override field by field.
function router(
  overrides: Partial<Record<string, string | null>> = {},
  fallbacks: Partial<Record<string, string[]>> = {}
) {
  const base = { default: null, background: null, think: null, longContext: null, webSearch: null, image: null }
  const emptyFallbacks = {
    default: [],
    background: [],
    think: [],
    longContext: [],
    webSearch: [],
    image: []
  }
  return { ...base, ...overrides, fallbacks: { ...emptyFallbacks, ...fallbacks } }
}

const noTraffic = { rows: [], total: 0 }

test('config-only lanes produce dashed primary edges with zero traffic', () => {
  const graph = buildRoutingGraph(router({ default: 'anthropic,sonnet' }), noTraffic)

  expect(graph.scenarioNodes.length).toBe(SCENARIOS.length)
  expect(graph.requestedNodes.length).toBe(0)
  expect(graph.modelNodes.map((n) => n.id)).toContain('m:anthropic,sonnet')

  const edge = graph.edges.find((e) => e.source === 's:default' && e.target === 'm:anthropic,sonnet')
  expect(edge?.count).toBe(0)
  expect(edge?.isPrimary).toBe(true)
  expect(edge?.rerouted).toBe(false)
})

test('honored traffic links requested → scenario → model at 100%', () => {
  const traffic = {
    rows: [
      {
        requestedModel: 'sonnet',
        total: 10,
        targets: [{ provider: 'anthropic', model: 'sonnet', scenario: 'default', count: 10 }]
      }
    ],
    total: 10
  }
  const graph = buildRoutingGraph(router({ default: 'anthropic,sonnet' }), traffic)

  // tier 1 → tier 2
  const reqEdge = graph.requestedEdges.find((e) => e.source === 'r:sonnet' && e.target === 's:default')
  expect(reqEdge?.count).toBe(10)
  expect(reqEdge?.pct).toBe(100)
  expect(graph.requestedNodes.find((n) => n.id === 'r:sonnet')?.requests).toBe(10)

  // tier 2 → tier 3
  const edge = graph.edges.find((e) => e.source === 's:default' && e.target === 'm:anthropic,sonnet')
  expect(edge?.count).toBe(10)
  expect(edge?.pct).toBe(100)
  expect(edge?.isPrimary).toBe(true)
  expect(edge?.rerouted).toBe(false)
  expect(graph.scenarioNodes.find((n) => n.scenario === 'default')?.requests).toBe(10)
})

test('traffic to a non-primary model is flagged rerouted with its share', () => {
  const traffic = {
    rows: [
      {
        requestedModel: 'sonnet',
        total: 4,
        targets: [
          { provider: 'anthropic', model: 'sonnet', scenario: 'default', count: 3 },
          { provider: 'openai', model: 'gpt-5', scenario: 'default', count: 1 }
        ]
      }
    ],
    total: 4
  }
  const graph = buildRoutingGraph(router({ default: 'anthropic,sonnet' }), traffic)

  const rerouted = graph.edges.find((e) => e.target === 'm:openai,gpt-5')
  expect(rerouted?.rerouted).toBe(true)
  expect(rerouted?.pct).toBe(25)

  const honored = graph.edges.find((e) => e.target === 'm:anthropic,sonnet')
  expect(honored?.rerouted).toBe(false)
  expect(honored?.pct).toBe(75)

  // The single requested model fans its whole share into one lane.
  const reqEdge = graph.requestedEdges.find((e) => e.source === 'r:sonnet' && e.target === 's:default')
  expect(reqEdge?.count).toBe(4)
  expect(reqEdge?.pct).toBe(100)
})

test('one requested model splitting across lanes gets per-lane shares', () => {
  const traffic = {
    rows: [
      {
        requestedModel: 'sonnet',
        total: 10,
        targets: [
          { provider: 'anthropic', model: 'sonnet', scenario: 'default', count: 7 },
          { provider: 'anthropic', model: 'opus', scenario: 'think', count: 3 }
        ]
      }
    ],
    total: 10
  }
  const graph = buildRoutingGraph(router(), traffic)

  const toDefault = graph.requestedEdges.find((e) => e.target === 's:default')
  const toThink = graph.requestedEdges.find((e) => e.target === 's:think')
  expect(toDefault?.pct).toBe(70)
  expect(toThink?.pct).toBe(30)
})

test('null requested model and scenario bucket into untracked nodes', () => {
  const traffic = {
    rows: [
      {
        requestedModel: null,
        total: 2,
        targets: [{ provider: 'anthropic', model: 'sonnet', scenario: null, count: 2 }]
      }
    ],
    total: 2
  }
  const graph = buildRoutingGraph(router(), traffic)

  expect(graph.requestedNodes.find((n) => n.requestedModel === UNTRACKED)?.requests).toBe(2)
  const lastScenario = graph.scenarioNodes[graph.scenarioNodes.length - 1]
  expect(lastScenario?.scenario).toBe(UNTRACKED)

  const edge = graph.edges.find((e) => e.source === `s:${UNTRACKED}`)
  expect(edge?.rerouted).toBe(false)
  expect(edge?.isPrimary).toBe(false)
})

test('focusing a requested model recomputes the downstream to its traffic', () => {
  const traffic = {
    rows: [
      {
        requestedModel: 'sonnet',
        total: 10,
        targets: [
          { provider: 'anthropic', model: 'sonnet', scenario: 'default', count: 8 },
          { provider: 'openai', model: 'gpt-5', scenario: 'default', count: 2 }
        ]
      },
      {
        requestedModel: 'opus',
        total: 4,
        targets: [{ provider: 'anthropic', model: 'opus', scenario: 'think', count: 4 }]
      }
    ],
    total: 14
  }

  // Unfocused: the default lane carries both sonnet targets (8 + 2 = 10).
  const all = buildRoutingGraph(router(), traffic)
  expect(all.scenarioNodes.find((n) => n.scenario === 'default')?.requests).toBe(10)

  const focused = buildRoutingGraph(router(), traffic, 'sonnet')
  // The node universe (tier 1) still lists every requested model.
  expect(focused.requestedNodes.length).toBe(2)
  // Downstream percentages now reflect only 'sonnet' traffic.
  expect(focused.edges.find((e) => e.target === 'm:anthropic,sonnet')?.pct).toBe(80)
  expect(focused.edges.find((e) => e.target === 'm:openai,gpt-5')?.pct).toBe(20)
  // The 'think' lane (fed only by 'opus') has no traffic under this focus.
  expect(focused.scenarioNodes.find((n) => n.scenario === 'think')?.requests).toBe(0)
  // Only the focused model's requested→scenario edges remain.
  expect(focused.requestedEdges.every((e) => e.source === 'r:sonnet')).toBe(true)
})

test('fallback models appear as edges even without traffic', () => {
  const graph = buildRoutingGraph(router({ default: 'anthropic,sonnet' }, { default: ['openai,gpt-5'] }), noTraffic)

  const fallbackEdge = graph.edges.find((e) => e.source === 's:default' && e.target === 'm:openai,gpt-5')
  expect(fallbackEdge?.isFallback).toBe(true)
  expect(fallbackEdge?.isPrimary).toBe(false)
  expect(fallbackEdge?.count).toBe(0)
})
