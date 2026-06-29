import { afterEach, expect, setSystemTime, test } from 'bun:test'
import {
  clearAccountExhaustion,
  clearProviderExhaustion,
  isAccountExhausted,
  isProviderExhausted,
  markAccountExhausted,
  markProviderExhausted
} from '../../src/services/failover-state'

// failover-state holds a process-global map; reset the clock and drop the
// providers / accounts each test touches so cases stay independent.
afterEach(() => {
  setSystemTime()
  clearProviderExhaustion('codex')
  clearProviderExhaustion('anthropic')
  clearAccountExhaustion('acct-a')
  clearAccountExhaustion('acct-b')
})

test('a provider stays exhausted until its reset time, then auto-clears', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  markProviderExhausted('codex', t0 + 60_000)
  expect(isProviderExhausted('codex')).toBe(true)

  setSystemTime(new Date(t0 + 59_000))
  expect(isProviderExhausted('codex')).toBe(true)

  // Past the reset time, the entry is evicted on read — back to primary.
  setSystemTime(new Date(t0 + 61_000))
  expect(isProviderExhausted('codex')).toBe(false)
})

test('an absent reset time falls back to the default cooldown', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  markProviderExhausted('codex')
  expect(isProviderExhausted('codex')).toBe(true)

  // Default cooldown is 5 minutes.
  setSystemTime(new Date(t0 + 4 * 60_000))
  expect(isProviderExhausted('codex')).toBe(true)
  setSystemTime(new Date(t0 + 6 * 60_000))
  expect(isProviderExhausted('codex')).toBe(false)
})

test('a precise reset time is not shortened by a later default-cooldown mark', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  // A 10-minute window from the usage API ...
  markProviderExhausted('anthropic', t0 + 10 * 60_000)
  // ... then a plain 429 mark (default 5-minute cooldown) must not move
  // the expiry earlier.
  markProviderExhausted('anthropic')

  setSystemTime(new Date(t0 + 7 * 60_000))
  expect(isProviderExhausted('anthropic')).toBe(true)
  setSystemTime(new Date(t0 + 11 * 60_000))
  expect(isProviderExhausted('anthropic')).toBe(false)
})

test('clearProviderExhaustion drops the mark immediately', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  markProviderExhausted('codex', t0 + 60_000)
  expect(isProviderExhausted('codex')).toBe(true)

  clearProviderExhaustion('codex')
  expect(isProviderExhausted('codex')).toBe(false)
})

// ─── Account-level marks ──────────────────────────────────────────────

test('an account exhaustion mark expires on its own without affecting peer accounts', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  markAccountExhausted('acct-a', t0 + 60_000)
  expect(isAccountExhausted('acct-a')).toBe(true)
  // Peer account is independent and stays usable.
  expect(isAccountExhausted('acct-b')).toBe(false)

  setSystemTime(new Date(t0 + 61_000))
  expect(isAccountExhausted('acct-a')).toBe(false)
})

test('account marks are independent of provider marks (and vice versa)', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  markAccountExhausted('acct-a', t0 + 60_000)
  // Marking ONE account must not knock out the whole provider.
  expect(isProviderExhausted('anthropic')).toBe(false)
  expect(isAccountExhausted('acct-a')).toBe(true)

  // ...and marking the provider does not implicitly mark every account
  // (we track them separately so the router can rotate accounts and
  // still respect provider-level exhaustion when needed).
  markProviderExhausted('anthropic', t0 + 60_000)
  expect(isProviderExhausted('anthropic')).toBe(true)
  expect(isAccountExhausted('acct-b')).toBe(false)
})

test('account default cooldown applies when no precise reset time is given', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  markAccountExhausted('acct-a')
  expect(isAccountExhausted('acct-a')).toBe(true)

  // Default cooldown is 5 minutes (same as the provider default).
  setSystemTime(new Date(t0 + 4 * 60_000))
  expect(isAccountExhausted('acct-a')).toBe(true)
  setSystemTime(new Date(t0 + 6 * 60_000))
  expect(isAccountExhausted('acct-a')).toBe(false)
})

test('clearAccountExhaustion drops the mark immediately', () => {
  const t0 = 1_700_000_000_000
  setSystemTime(new Date(t0))

  markAccountExhausted('acct-a', t0 + 60_000)
  expect(isAccountExhausted('acct-a')).toBe(true)

  clearAccountExhaustion('acct-a')
  expect(isAccountExhausted('acct-a')).toBe(false)
})
