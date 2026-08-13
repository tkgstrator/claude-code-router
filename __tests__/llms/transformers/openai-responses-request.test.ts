import { describe, expect, test } from 'bun:test'
import { remapToolChoice } from '../../../src/llms/transformers/openai/responses/request'

// remapToolChoice reshapes the unified Chat-Completions tool_choice into
// the flat Responses-API form. See the helper's block comment for the
// exact rules — the tests below pin each branch.

describe('remapToolChoice', () => {
  test('returns undefined when the request has no tool_choice', () => {
    expect(remapToolChoice(undefined)).toBeUndefined()
  })

  test('passes string literals through verbatim (auto / none / required)', () => {
    expect(remapToolChoice('auto')).toBe('auto')
    expect(remapToolChoice('none')).toBe('none')
    expect(remapToolChoice('required')).toBe('required')
  })

  test('flattens { type: "function", function: { name } } to { type, name }', () => {
    expect(remapToolChoice({ type: 'function', function: { name: 'WebSearch' } })).toEqual({
      type: 'function',
      name: 'WebSearch'
    })
  })

  test('collapses a web_search-targeting choice to the hosted-tool shape', () => {
    // remapTools emits `{type:'web_search'}` for the Anthropic hosted
    // web_search tool; a tool_choice pointing at it must match that
    // shape or the Responses API rejects the name as unknown.
    expect(remapToolChoice({ type: 'function', function: { name: 'web_search' } })).toEqual({ type: 'web_search' })
  })
})
