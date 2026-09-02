/**
 * The first-run gate's contract.
 *
 * `ProtectedRoute` sends the user to `/setup` when there are no providers
 * AND setup has not been offered yet. Unless that second condition really
 * flips to false, `/setup`'s "Skip setup" navigates to `/overview`, the
 * gate re-evaluates and pulls the user straight back — a screen where
 * **pressing the button does nothing**. That is what shipped:
 * `markSetupOffered()` was called from nowhere (now called when
 * `SetupScreen` mounts).
 *
 * Failing **towards `true` (already offered)** when storage is unusable
 * is part of the contract too. The other way round, a browser that cannot
 * remember would be locked behind the gate forever.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isFreshInstall,
  isProviderConnected,
  markSetupOffered,
  setupAlreadyOffered
} from '../../src/components/rialto/system/first-run'
import type { Config, Provider } from '../../src/types'

// bun test has no browser environment, so this is the smallest stub
// carrying the two methods that are actually used.
type StorageStub = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

const installStorage = (stub: StorageStub): void => {
  Reflect.set(globalThis, 'sessionStorage', stub)
}

const workingStorage = (): StorageStub => {
  const store = new Map<string, string>()
  return {
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k, v) => {
      store.set(k, v)
    }
  }
}

const throwingStorage = (): StorageStub => ({
  getItem: () => {
    throw new Error('storage disabled')
  },
  setItem: () => {
    throw new Error('storage disabled')
  }
})

const original = Reflect.get(globalThis, 'sessionStorage')

beforeEach(() => installStorage(workingStorage()))
afterEach(() => Reflect.set(globalThis, 'sessionStorage', original))

describe('offering setup exactly once', () => {
  test('starts un-offered', () => {
    expect(setupAlreadyOffered()).toBe(false)
  })

  test('marking makes it offered — without this Skip setup does nothing', () => {
    markSetupOffered()
    expect(setupAlreadyOffered()).toBe(true)
  })

  test('falls back to "already offered" when storage is unusable, so the gate cannot trap anyone', () => {
    installStorage(throwingStorage())
    expect(setupAlreadyOffered()).toBe(true)
    // A failed write must not throw. All that is lost is the nudge,
    // which is the harmless direction to fail in.
    expect(() => markSetupOffered()).not.toThrow()
  })
})

describe('isFreshInstall', () => {
  const withProviders = (providers: Provider[]): Config => ({ Providers: providers }) as Config

  test('true only when no provider is configured', () => {
    expect(isFreshInstall(withProviders([]))).toBe(true)
    expect(isFreshInstall(withProviders([{ name: 'openai' }] as Provider[]))).toBe(false)
  })

  test('does not decide while the config is still null', () => {
    // Redirecting to /setup mid-load would make an install that is in
    // fact configured look, for a moment, like a fresh one.
    expect(isFreshInstall(null)).toBe(false)
  })
})

describe('isProviderConnected', () => {
  test('api_key: connected once there is a non-empty key', () => {
    expect(isProviderConnected({ auth_mode: 'api_key', api_key: 'sk-x' } as Provider)).toBe(true)
    expect(isProviderConnected({ auth_mode: 'api_key', api_key: '' } as Provider)).toBe(false)
    expect(isProviderConnected({ auth_mode: 'api_key', api_key: null } as Provider)).toBe(false)
  })

  test('subscription: connected once one account is enabled', () => {
    const sub = (accounts: Array<{ enabled: boolean }> | undefined): Provider =>
      ({ auth_mode: 'subscription', api_key: null, subscription_accounts: accounts }) as Provider
    expect(isProviderConnected(sub([{ enabled: true }]))).toBe(true)
    expect(isProviderConnected(sub([{ enabled: false }]))).toBe(false)
    // A row that was only seeded. Being in the catalog does not make it
    // usable.
    expect(isProviderConnected(sub([]))).toBe(false)
    expect(isProviderConnected(sub(undefined))).toBe(false)
  })
})
