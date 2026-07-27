import { expect, test } from 'bun:test'
import { flattenNestedRouter, type Router } from '../../src/schemas'

// A nested wire Router where every one of the four flat maps × six
// scenarios carries a DISTINGUISHABLE value, so a transposition
// (subagent primaries landing in agentFallbacks, or the think slot
// getting the background value) is caught by the exact toEqual below.
// flattenNestedRouter is the single boundary between the nested wire
// config and the flat runtime config; every engine test hand-writes flat
// objects and bypasses it, so this is the only coverage of that link.
const route = (primary: string, fallback: string) => ({ primary, fallbacks: [fallback] })

const nested: Router = {
  default: {
    agent: route('p,agent-default', 'p,agent-default-fb'),
    subagent: route('p,sub-default', 'p,sub-default-fb')
  },
  background: {
    agent: route('p,agent-background', 'p,agent-background-fb'),
    subagent: route('p,sub-background', 'p,sub-background-fb')
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
      background: 'p,agent-background',
      think: 'p,agent-think',
      longContext: 'p,agent-longContext',
      webSearch: 'p,agent-webSearch',
      image: 'p,agent-image'
    },
    subagent: {
      default: 'p,sub-default',
      background: 'p,sub-background',
      think: 'p,sub-think',
      longContext: 'p,sub-longContext',
      webSearch: 'p,sub-webSearch',
      image: 'p,sub-image'
    },
    agentFallbacks: {
      default: ['p,agent-default-fb'],
      background: ['p,agent-background-fb'],
      think: ['p,agent-think-fb'],
      longContext: ['p,agent-longContext-fb'],
      webSearch: ['p,agent-webSearch-fb'],
      image: ['p,agent-image-fb']
    },
    subagentFallbacks: {
      default: ['p,sub-default-fb'],
      background: ['p,sub-background-fb'],
      think: ['p,sub-think-fb'],
      longContext: ['p,sub-longContext-fb'],
      webSearch: ['p,sub-webSearch-fb'],
      image: ['p,sub-image-fb']
    },
    longContextThreshold: 123_456,
    persona: 'pirate'
  })
})
