/**
 * `anthropic-beta` header reshaping for the subscription (OAuth) path.
 *
 * Deliberately dependency-free: this is the one piece of the invocation
 * pipeline worth exercising directly from unit tests, and importing the
 * enclosing module would drag the whole llms barrel in with it.
 */

// Identifies the caller as Claude Code to Anthropic's OAuth surface.
// Without it, premium models route to the API "overage" path instead of
// the subscription allotment — which is org-disabled on subscriptions.
const OAUTH_BETA = 'oauth-2025-04-20'

// Reshape `anthropic-beta` for the subscription (OAuth) path:
//  - ensure OAUTH_BETA is present so premium models route to the
//    subscription allotment instead of org-disabled overage.
//  - drop `context-1m-*` ONLY when `longContextDenied` says this target
//    has actually been refused the long-context entitlement.
//
// The strip used to be unconditional, which capped every subscription at
// 200K even on plans that do carry 1M. That is not a silent no-op:
// Claude Code still displays "1M context" and sizes its own context
// budget against 1M, so it declines to compact and the request dies
// upstream the moment the transcript passes 200K. Preserving the token
// by default keeps the window the client asked for; the denial flag only
// turns true after `isLongContextGate` saw the upstream refuse it, so a
// non-1M plan still degrades to 200K — one refusal later, not forever.
//
// `longContextDenied` is resolved by the caller (which owns the provider
// name and the sticky session→account mapping) so this stays a pure
// header rewrite.
export function prepareSubscriptionBetas(headers: Record<string, string>, longContextDenied: boolean): void {
  const raw = headers['anthropic-beta']
  const tokens =
    typeof raw === 'string'
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  const kept = longContextDenied ? tokens.filter((t) => !t.startsWith('context-1m')) : [...tokens]
  if (!kept.includes(OAUTH_BETA)) kept.push(OAUTH_BETA)
  headers['anthropic-beta'] = kept.join(',')
}
