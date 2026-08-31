/**
 * Rule helpers shared by the Chain rail and the Rules screen.
 *
 * Rules live per (scenario, lane) on the Router config, so a "rule" only
 * has an identity once you say which chain it belongs to. `ScopedRule`
 * carries that scope alongside the rule so a flat list can still address
 * the right array when it saves.
 */
import type { RouteRule, RouterConfig } from '@/schemas'
import type { Lane, ScenarioKey } from './types'
import { LANES, SCENARIOS } from './types'

export interface RuleScope {
  scenario: ScenarioKey
  lane: Lane
  index: number
}

export interface ScopedRule extends RuleScope {
  rule: RouteRule
}

/** Every rule in the config, in the order the runtime would meet them. */
export function allRules(router: RouterConfig): ScopedRule[] {
  const out: ScopedRule[] = []
  for (const scenario of SCENARIOS) {
    for (const lane of LANES) {
      for (const [index, rule] of router[scenario][lane].rules.entries()) out.push({ scenario, lane, index, rule })
    }
  }
  return out
}

export const sameScope = (a: RuleScope, b: RuleScope): boolean =>
  a.scenario === b.scenario && a.lane === b.lane && a.index === b.index

/** Token counts are stored raw but read in thousands, as the editor writes them. */
const fmtK = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/**
 * One condition per predicate field that is actually set. Rendered as the
 * field / operator / value triple the editor edits, so the summary and the
 * form never disagree about what a rule says.
 */
export interface Condition {
  field: string
  op: string
  value: string
}

export function conditionsOf(rule: RouteRule): Condition[] {
  const when = rule.when
  const out: Condition[] = []
  if (when.requestedTier !== undefined)
    out.push({ field: 'requestedTier', op: 'in', value: when.requestedTier.join(', ') })
  if (when.requestedModel !== undefined)
    out.push({ field: 'requestedModel', op: 'matches', value: when.requestedModel })
  if (when.thinking !== undefined) out.push({ field: 'thinking', op: 'is', value: when.thinking ? 'true' : 'false' })
  if (when.minTokens !== undefined && when.minTokens > 0) {
    out.push({ field: 'tokens', op: '>=', value: fmtK(when.minTokens) })
  }
  if (when.maxTokens !== undefined && when.maxTokens > 0) {
    out.push({ field: 'tokens', op: '<=', value: fmtK(when.maxTokens) })
  }
  if (when.hasTool !== undefined) out.push({ field: 'hasTool', op: 'matches', value: when.hasTool })
  if (when.effort !== undefined) out.push({ field: 'effort', op: 'in', value: when.effort.join(', ') })
  return out
}

/** Single-line predicate summary for list rows and the chain rail. */
export function summarizePredicate(rule: RouteRule): string {
  const conditions = conditionsOf(rule)
  if (conditions.length === 0) return 'matches every request'
  return conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(' · ')
}

/** What a matched rule routes to. A null target is a legitimate "leave it alone". */
export function summarizeTarget(rule: RouteRule): string {
  return rule.target === null || rule.target.length === 0 ? 'caller model (no rewrite)' : rule.target
}

export function ruleLabel(rule: RouteRule, index: number): string {
  return rule.name === undefined || rule.name === '' ? `Rule ${index + 1}` : rule.name
}

// ─── Tester ───────────────────────────────────────────────────────────
//
// The walk itself runs on the server (`POST /api/routing-rules/test`):
// `minTokens` / `maxTokens` are evaluated against the real tokenizer, and
// a browser-side guess at that count would silently reorder a
// first-match-wins answer.

export type ConditionField =
  | 'requestedTier'
  | 'requestedModel'
  | 'thinking'
  | 'minTokens'
  | 'maxTokens'
  | 'hasTool'
  | 'effort'

/**
 * One predicate field's verdict. Predicate fields AND together, so
 * "the rule did not match" is only useful next to which of its conditions
 * was responsible.
 */
export interface RuleCondition {
  field: ConditionField
  /** Already formatted for display by the server — print it as given. */
  expected: string
  /**
   * What the request presented. Null means it presented nothing for this
   * field, which is a different diagnosis from presenting a value that
   * did not match.
   */
  actual: string | null
  matched: boolean
}

export interface RuleVerdict {
  index: number
  name: string | null
  matched: boolean
  /** Empty for a rule with no predicate — it matches everything. */
  conditions: RuleCondition[]
}

export interface RuleTestResult {
  /** Null when nothing matched — the request falls through to the catch-all. */
  matchedIndex: number | null
  matchedName: string | null
  /** Null on a match means "deliberately do not reroute", not "no match". */
  target: string | null
  /** Rules after the match that were never reached. */
  notEvaluated: number
  /** Verdicts up to and including the match. */
  evaluated: RuleVerdict[]
  /** The real tokenizer's count — what the size predicates were measured against. */
  tokenCount: number
}
