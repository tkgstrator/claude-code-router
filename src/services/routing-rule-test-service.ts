/**
 * Dry-run a request against a rule stack.
 *
 * Rules are ordered and first-match-wins, which is impossible to reason
 * about by reading them — that is why the Rules view has a tester. The
 * point of the tester is that it runs the SAME predicate code the router
 * runs (`matchesRule` from scenario-router/model-selection) over the
 * SAME token count (the real tokenizer, not an estimate), so a rule that
 * tests as matching really does match at request time. A tester with its
 * own matching logic would eventually disagree with the router, which is
 * worse than having no tester.
 *
 * Evaluation stops at the first match and reports what was never
 * reached, because "rule 4 never fires" is usually caused by rule 2.
 */

import type { RouteRule } from '@/schemas'
import { getLlmsContext } from '../llms/context'
import { matchesRule } from '../llms/scenario-router/model-selection'
import type { RouterRequestBody } from '../llms/scenario-router/types'

export interface RuleVerdict {
  index: number
  name: string | null
  matched: boolean
}

export interface RuleTestResult {
  /** Index of the first matching rule, or null when none matched. */
  matchedIndex: number | null
  matchedName: string | null
  /**
   * Where a match routes. Null on a match whose rule has no target — a
   * deliberate "do not reroute these" rule, which is a different outcome
   * from no rule matching at all.
   */
  target: string | null
  /** Rules after the match that were never evaluated. */
  notEvaluated: number
  /** Verdicts up to and including the match. */
  evaluated: RuleVerdict[]
  /** Token count the predicates were evaluated against. */
  tokenCount: number
}

const ruleName = (rule: RouteRule): string | null =>
  typeof rule.name === 'string' && rule.name.length > 0 ? rule.name : null

export async function testRules(rules: RouteRule[], body: RouterRequestBody): Promise<RuleTestResult> {
  const ctxDeps = await getLlmsContext()
  const counted = await ctxDeps.tokenizers.countTokens({
    messages: Array.isArray(body.messages) ? body.messages : [],
    system: body.system,
    tools: body.tools
  })
  const tokenCount = counted.tokenCount
  // The matcher logs "Matched routing rule" on a hit. A dry run routed
  // no traffic, so that line must not reach the server log — a silent
  // child keeps the real Logger type without emitting.
  const log = ctxDeps.log.child({}, { level: 'silent' })
  const ctx = { req: { body, log }, tokenCount }

  const evaluated: RuleVerdict[] = []
  for (const [index, rule] of rules.entries()) {
    const matched = matchesRule(rule, ctx)
    evaluated.push({ index, name: ruleName(rule), matched })
    if (!matched) continue
    return {
      matchedIndex: index,
      matchedName: ruleName(rule),
      target: typeof rule.target === 'string' && rule.target.length > 0 ? rule.target : null,
      notEvaluated: rules.length - index - 1,
      evaluated,
      tokenCount
    }
  }

  return { matchedIndex: null, matchedName: null, target: null, notEvaluated: 0, evaluated, tokenCount }
}
