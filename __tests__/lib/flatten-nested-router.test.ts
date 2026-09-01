import { expect, test } from 'bun:test'
import { flattenNestedRouter, type Router } from '../../src/schemas/domain/router'

// A nested wire Router where every one of the six flat maps × five
// scenarios carries a DISTINGUISHABLE value, so a transposition
// (subagent primaries landing in agentFallbacks, or the think slot
// getting the webSearch value) is caught by the exact toEqual below.
// flattenNestedRouter is the single boundary between the nested wire
// config and the flat runtime config; every engine test hand-writes flat
// objects and bypasses it, so this is the only coverage of that link.
const route = (primary: string, fallback: string) => ({ primary, fallbacks: [fallback], rules: [] })

const nested: Router = {
  default: {
    agent: route('p,agent-default', 'p,agent-default-fb'),
    subagent: route('p,sub-default', 'p,sub-default-fb')
  },
  think: {
    agent: route('p,agent-think', 'p,agent-think-fb'),
    subagent: route('p,sub-think', 'p,sub-think-fb')
  },
  longContext: {
    agent: route('p,agent-longContext', 'p,agent-longContext-fb'),
    subagent: route('p,sub-longContext', 'p,sub-longContext-fb'),
    threshold: 123_456
  },
  webSearch: {
    agent: route('p,agent-webSearch', 'p,agent-webSearch-fb'),
    subagent: route('p,sub-webSearch', 'p,sub-webSearch-fb')
  },
  image: {
    agent: route('p,agent-image', 'p,agent-image-fb'),
    subagent: route('p,sub-image', 'p,sub-image-fb')
  },
  persona: 'pirate'
}

test('flattenNestedRouter maps every route/scenario to the right flat slot', () => {
  expect(flattenNestedRouter(nested)).toEqual({
    agent: {
      default: 'p,agent-default',
      think: 'p,agent-think',
      longContext: 'p,agent-longContext',
      webSearch: 'p,agent-webSearch',
      image: 'p,agent-image'
    },
    subagent: {
      default: 'p,sub-default',
      think: 'p,sub-think',
      longContext: 'p,sub-longContext',
      webSearch: 'p,sub-webSearch',
      image: 'p,sub-image'
    },
    agentFallbacks: {
      default: ['p,agent-default-fb'],
      think: ['p,agent-think-fb'],
      longContext: ['p,agent-longContext-fb'],
      webSearch: ['p,agent-webSearch-fb'],
      image: ['p,agent-image-fb']
    },
    subagentFallbacks: {
      default: ['p,sub-default-fb'],
      think: ['p,sub-think-fb'],
      longContext: ['p,sub-longContext-fb'],
      webSearch: ['p,sub-webSearch-fb'],
      image: ['p,sub-image-fb']
    },
    agentRules: {
      default: [],
      think: [],
      longContext: [],
      webSearch: [],
      image: []
    },
    subagentRules: {
      default: [],
      think: [],
      longContext: [],
      webSearch: [],
      image: []
    },
    longContextThreshold: 123_456,
    defaultAgentContextWindow: null,
    persona: 'pirate'
  })
})

test('flattenNestedRouter carries defaultAgentContextWindow through from opts', () => {
  const flat = flattenNestedRouter(nested, { defaultAgentContextWindow: 200_000 })
  expect(flat.defaultAgentContextWindow).toBe(200_000)
})

test('flattenNestedRouter clamps a non-positive contextWindow to null', () => {
  const flat = flattenNestedRouter(nested, { defaultAgentContextWindow: 0 })
  expect(flat.defaultAgentContextWindow).toBe(null)
})

test('flattenNestedRouter preserves per-scenario rules on both kinds', () => {
  const withRules: Router = {
    ...nested,
    default: {
      agent: {
        primary: 'p,agent-default',
        fallbacks: [],
        rules: [
          {
            name: 'haiku',
            when: { requestedModel: '*haiku*' },
            target: 'p,haiku-target'
          }
        ]
      },
      subagent: { primary: null, fallbacks: [], rules: [] }
    }
  }
  const flat = flattenNestedRouter(withRules)
  expect(flat.agentRules.default).toEqual([
    {
      name: 'haiku',
      when: { requestedModel: '*haiku*' },
      target: 'p,haiku-target'
    }
  ])
  expect(flat.subagentRules.default).toEqual([])
})
