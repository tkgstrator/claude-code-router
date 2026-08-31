/**
 * Rule predicate evaluation.
 *
 * Split from `model-selection.ts` because a predicate verdict is worth
 * reading on its own: `explainRule` backs the Rule Tester screen, where
 * nothing about scenarios or route kinds is in play — the operator has a
 * rule and a request and wants to know which condition failed. Keeping
 * the walker (`resolveTarget`) on the other side of this boundary also
 * keeps the promise that the tester and the router cannot disagree,
 * because both reach the same `explainRule`.
 */

import type { RouteRule } from '@/schemas/domain/router'
import { globMatch, hasMatchingTool, isThinkingEnabled, readEffort, tierOf, toolTypes } from './request-signals'
import type { RouterRequest } from './types'

// Context available to predicate evaluation. All rule predicates read
// through this shape so adding a new predicate never has to thread a
// new argument through selectModel's call sites.
export interface RuleEvalContext {
  req: RouterRequest
  tokenCount: number
}
/** One predicate field's verdict, with the value it was judged against. */
export interface ConditionVerdict {
  field: 'requestedTier' | 'requestedModel' | 'thinking' | 'minTokens' | 'maxTokens' | 'hasTool' | 'effort'
  expected: string
  /** What the request actually presented. Null when it presented nothing. */
  actual: string | null
  matched: boolean
}

const show = (value: unknown): string => (Array.isArray(value) ? value.join(', ') : String(value))

/**
 * Evaluate a rule's predicate and report each populated field separately.
 *
 * An empty predicate matches everything (catch-all rule). Absent fields
 * are unconstrained; each populated field is an AND with the others —
 * which is precisely why a per-field verdict is worth having. "This rule
 * did not match" leaves the operator to guess which of five conditions
 * was responsible.
 *
 * `matchesRule` is defined in terms of this, so the tester and the
 * router cannot disagree about a rule: there is only one implementation.
 */
export function explainRule(
  rule: RouteRule,
  ctx: RuleEvalContext
): { matched: boolean; conditions: ConditionVerdict[] } {
  const when = rule.when
  const { req, tokenCount } = ctx
  const conditions: ConditionVerdict[] = []

  if (when.requestedTier !== undefined) {
    const tier = tierOf(req.body.model)
    conditions.push({
      field: 'requestedTier',
      expected: show(when.requestedTier),
      actual: tier === undefined ? null : tier,
      matched: tier !== undefined && when.requestedTier.includes(tier)
    })
  }
  if (when.requestedModel !== undefined) {
    conditions.push({
      field: 'requestedModel',
      expected: when.requestedModel,
      actual: req.body.model,
      matched: globMatch(when.requestedModel, req.body.model)
    })
  }
  if (when.thinking !== undefined) {
    const thinking = isThinkingEnabled(req.body)
    conditions.push({
      field: 'thinking',
      expected: show(when.thinking),
      actual: show(thinking),
      matched: thinking === when.thinking
    })
  }
  if (when.minTokens !== undefined) {
    conditions.push({
      field: 'minTokens',
      expected: `>= ${when.minTokens}`,
      actual: String(tokenCount),
      matched: tokenCount >= when.minTokens
    })
  }
  if (when.maxTokens !== undefined) {
    conditions.push({
      field: 'maxTokens',
      expected: `<= ${when.maxTokens}`,
      actual: String(tokenCount),
      matched: tokenCount <= when.maxTokens
    })
  }
  if (when.hasTool !== undefined) {
    conditions.push({
      field: 'hasTool',
      expected: when.hasTool,
      actual: toolTypes(req.body.tools),
      matched: hasMatchingTool(req.body.tools, when.hasTool)
    })
  }
  if (when.effort !== undefined) {
    const effort = readEffort(req.body)
    conditions.push({
      field: 'effort',
      expected: show(when.effort),
      actual: effort === undefined ? null : effort,
      matched: effort !== undefined && when.effort.includes(effort)
    })
  }

  return { matched: conditions.every((c) => c.matched), conditions }
}

export function matchesRule(rule: RouteRule, ctx: RuleEvalContext): boolean {
  return explainRule(rule, ctx).matched
}
