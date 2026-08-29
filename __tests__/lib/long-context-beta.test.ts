import { expect, test } from 'bun:test'
import { HTTPException } from 'hono/http-exception'
import { prepareSubscriptionBetas } from '../../src/api/v1/subscription-betas'
import { isLongContextGate } from '../../src/api/v1/upstream-error'
import {
  clearLongContextDenial,
  isLongContextDenied,
  markLongContextDenied
} from '../../src/services/failover-state'

const OAUTH_BETA = 'oauth-2025-04-20'
const CLIENT_BETAS = 'claude-code-20250219,context-1m-2025-08-07,fine-grained-tool-streaming-2025-05-14'

// Shape sendToProvider throws on upstream failure; both isRateLimited and
// isLongContextGate parse this exact string.
const providerError = (status: number, body: string): HTTPException =>
  new HTTPException(500, { message: `Error from provider(anthropic,claude-opus-5: ${status}): ${body}` })

// ─── prepareSubscriptionBetas ──────────────────────────────────────────

test('context-1m survives when the target has not been refused long context', () => {
  const headers: Record<string, string> = { 'anthropic-beta': CLIENT_BETAS }
  prepareSubscriptionBetas(headers, false)
  const tokens = headers['anthropic-beta'].split(',')
  // The regression this guards: an unconditional strip silently capped
  // every subscription at 200K while Claude Code still displayed and
  // budgeted for 1M.
  expect(tokens).toContain('context-1m-2025-08-07')
  expect(tokens).toContain(OAUTH_BETA)
  expect(tokens).toContain('claude-code-20250219')
})

test('context-1m is dropped once the target is known to lack the entitlement', () => {
  const headers: Record<string, string> = { 'anthropic-beta': CLIENT_BETAS }
  prepareSubscriptionBetas(headers, true)
  const tokens = headers['anthropic-beta'].split(',')
  expect(tokens).not.toContain('context-1m-2025-08-07')
  // Every other client beta is preserved verbatim.
  expect(tokens).toContain('claude-code-20250219')
  expect(tokens).toContain('fine-grained-tool-streaming-2025-05-14')
  expect(tokens).toContain(OAUTH_BETA)
})

test('the oauth beta is added even when the client sent no betas at all', () => {
  const headers: Record<string, string> = {}
  prepareSubscriptionBetas(headers, false)
  expect(headers['anthropic-beta']).toBe(OAUTH_BETA)
})

test('the oauth beta is never duplicated', () => {
  const headers: Record<string, string> = { 'anthropic-beta': OAUTH_BETA }
  prepareSubscriptionBetas(headers, true)
  expect(headers['anthropic-beta'].split(',').filter((t) => t === OAUTH_BETA)).toHaveLength(1)
})

// ─── isLongContextGate ─────────────────────────────────────────────────

test('the long-context gate is recognised on a 429', () => {
  const err = providerError(
    429,
    '{"type":"error","error":{"type":"rate_limit_error","message":"Extra usage is required for long context requests"}}'
  )
  expect(isLongContextGate(err)).toBe(true)
})

test('the long-context gate is recognised when an upstream shapes it as a 400', () => {
  const err = providerError(400, '{"error":{"message":"This long context request requires extra usage"}}')
  expect(isLongContextGate(err)).toBe(true)
})

test('an ordinary quota 429 is not mistaken for the long-context gate', () => {
  // Must stay false: this one has to fail over / rotate accounts, not
  // retry the same target with one header removed.
  const err = providerError(
    429,
    '{"type":"error","error":{"type":"rate_limit_error","message":"5-hour limit reached"}}'
  )
  expect(isLongContextGate(err)).toBe(false)
})

test('non-provider-shaped errors are not treated as the gate', () => {
  expect(isLongContextGate(new HTTPException(429, { message: 'long context request' }))).toBe(false)
  expect(isLongContextGate(new Error('Extra usage is required for long context requests'))).toBe(false)
  expect(isLongContextGate(null)).toBe(false)
})

// ─── denial marks ──────────────────────────────────────────────────────

test('an unmarked target is not denied', () => {
  expect(isLongContextDenied('unmarked-provider', 'acct-1')).toBe(false)
})

test('an account-scoped denial does not speak for its peer accounts', () => {
  markLongContextDenied('prov-scoped', 'acct-no-1m')
  expect(isLongContextDenied('prov-scoped', 'acct-no-1m')).toBe(true)
  // A peer account on the same provider may well carry the entitlement.
  expect(isLongContextDenied('prov-scoped', 'acct-has-1m')).toBe(false)
  clearLongContextDenial('prov-scoped', 'acct-no-1m')
  expect(isLongContextDenied('prov-scoped', 'acct-no-1m')).toBe(false)
})

test('a provider-level denial applies to every account under it', () => {
  // Learned on the accountless overlay path, where no sub-account was
  // resolved; it still has to cover accounts seen later.
  markLongContextDenied('prov-wide', null)
  expect(isLongContextDenied('prov-wide', null)).toBe(true)
  expect(isLongContextDenied('prov-wide', 'any-account')).toBe(true)
  clearLongContextDenial('prov-wide', null)
  expect(isLongContextDenied('prov-wide', 'any-account')).toBe(false)
})
