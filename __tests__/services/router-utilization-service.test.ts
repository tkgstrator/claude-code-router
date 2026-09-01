import { expect, test } from 'bun:test'
import { detectSuggestions } from '../../src/services/router-utilization-service'

test('detectSuggestions flags primary that received almost no traffic', () => {
  const out = detectSuggestions({
    perTarget: [
      { requestedModel: null, sentTo: 'claude-code,claude-fable-5', count: 3 },
      { requestedModel: null, sentTo: 'claude-code,claude-opus-5', count: 400 },
      { requestedModel: null, sentTo: 'claude-code,claude-sonnet-5', count: 100 }
    ],
    preferences: [
      { target: 'claude-code,claude-fable-5', enabled: true },
      { target: 'claude-code,claude-opus-5', enabled: true }
    ]
  })
  expect(out).toHaveLength(1)
  expect(out[0].kind).toBe('primary_never_reached')
  expect(out[0].target).toBe('claude-code,claude-fable-5')
})

test('detectSuggestions emits nothing when the primary is dominant', () => {
  const out = detectSuggestions({
    perTarget: [
      { requestedModel: null, sentTo: 'claude-code,claude-fable-5', count: 400 },
      { requestedModel: null, sentTo: 'claude-code,claude-opus-5', count: 50 }
    ],
    preferences: [
      { target: 'claude-code,claude-fable-5', enabled: true },
      { target: 'claude-code,claude-opus-5', enabled: true }
    ]
  })
  expect(out).toEqual([])
})

test('detectSuggestions returns nothing when there is no traffic yet', () => {
  const out = detectSuggestions({ perTarget: [], preferences: [] })
  expect(out).toEqual([])
})

test('detectSuggestions ignores disabled entries when scanning primary', () => {
  const out = detectSuggestions({
    perTarget: [{ requestedModel: null, sentTo: 'claude-code,claude-opus-5', count: 500 }],
    preferences: [
      { target: 'claude-code,claude-fable-5', enabled: false },
      { target: 'claude-code,claude-opus-5', enabled: true }
    ]
  })
  // opus is the top ENABLED primary and it has all the traffic — no flag.
  expect(out).toEqual([])
})
