/**
 * Per-condition rule explanation.
 *
 * Rule predicates are ANDed, so "this rule did not match" leaves an
 * operator guessing which of five conditions was responsible. The
 * tester reports each field separately — and because `matchesRule` is
 * defined in terms of `explainRule`, the tester and the router cannot
 * drift apart about whether a rule fires.
 */
import { describe, expect, test } from 'bun:test'
import type { RouteRule } from '../../src/schemas/domain/router'
import { explainRule, matchesRule } from '../../src/llms/scenario-router/model-selection'

// explainRule reads only body and tokenCount; the logger on RouterRequest
// is never touched on this path.
const ctxFor = (model: string, tokenCount = 100, extra: Record<string, unknown> = {}) =>
  ({ req: { body: { model, ...extra } }, tokenCount }) as unknown as Parameters<typeof explainRule>[1]

const rule = (when: Record<string, unknown>): RouteRule =>
  ({ name: 'r', when, target: 'p,m' }) as unknown as RouteRule

const byField = (conditions: ReturnType<typeof explainRule>['conditions'], field: string) =>
  conditions.find((c) => c.field === field)

describe('explainRule', () => {
  test('an empty predicate matches everything and reports no conditions', () => {
    const out = explainRule(rule({}), ctxFor('claude-haiku-4-5'))
    expect(out.matched).toBe(true)
    expect(out.conditions).toHaveLength(0)
  })

  test('reports only the fields the predicate actually constrains', () => {
    const out = explainRule(rule({ requestedModel: '*haiku*' }), ctxFor('claude-haiku-4-5'))
    expect(out.conditions.map((c) => c.field)).toEqual(['requestedModel'])
  })

  test('names which single condition failed when the others passed', () => {
    const out = explainRule(
      rule({ requestedTier: ['haiku'], minTokens: 50_000 }),
      ctxFor('claude-haiku-4-5', 100)
    )
    expect(out.matched).toBe(false)
    expect(byField(out.conditions, 'requestedTier')?.matched).toBe(true)
    expect(byField(out.conditions, 'minTokens')?.matched).toBe(false)
  })

  test('carries the observed value so a failure explains itself', () => {
    const out = explainRule(rule({ minTokens: 50_000 }), ctxFor('gpt-5', 1234))
    const cond = byField(out.conditions, 'minTokens')
    expect(cond?.expected).toBe('>= 50000')
    expect(cond?.actual).toBe('1234')
  })

  test('distinguishes "presented nothing" from "presented a value that did not match"', () => {
    // gpt-5 belongs to no Claude tier at all, so there is no observed tier.
    const noTier = explainRule(rule({ requestedTier: ['opus'] }), ctxFor('gpt-5'))
    expect(byField(noTier.conditions, 'requestedTier')?.actual).toBeNull()

    const wrongTier = explainRule(rule({ requestedTier: ['opus'] }), ctxFor('claude-haiku-4-5'))
    expect(byField(wrongTier.conditions, 'requestedTier')?.actual).toBe('haiku')
  })

  test('reports the tools the request carried, not just that none matched', () => {
    const out = explainRule(
      rule({ hasTool: 'web_*' }),
      ctxFor('gpt-5', 100, { tools: [{ type: 'bash_20250124' }, { type: 'text_editor' }] })
    )
    expect(out.matched).toBe(false)
    expect(byField(out.conditions, 'hasTool')?.actual).toBe('bash_20250124, text_editor')
  })

  test('a request with no tools at all reports null rather than an empty string', () => {
    const out = explainRule(rule({ hasTool: 'web_*' }), ctxFor('gpt-5'))
    expect(byField(out.conditions, 'hasTool')?.actual).toBeNull()
  })

  test('all conditions must hold for the rule to match', () => {
    const both = rule({ requestedModel: '*haiku*', requestedTier: ['haiku'] })
    expect(explainRule(both, ctxFor('claude-haiku-4-5')).matched).toBe(true)
    expect(explainRule(both, ctxFor('claude-opus-4-8')).matched).toBe(false)
  })

  test('matchesRule agrees with explainRule by construction', () => {
    const cases: Array<[Record<string, unknown>, string, number]> = [
      [{}, 'gpt-5', 10],
      [{ requestedTier: ['opus'] }, 'claude-opus-4-8', 10],
      [{ minTokens: 5, maxTokens: 20 }, 'gpt-5', 12],
      [{ minTokens: 5, maxTokens: 20 }, 'gpt-5', 200],
      [{ requestedModel: 'exact' }, 'exact', 1]
    ]
    for (const [when, model, tokens] of cases) {
      const ctx = ctxFor(model, tokens)
      expect(matchesRule(rule(when), ctx)).toBe(explainRule(rule(when), ctx).matched)
    }
  })
})
