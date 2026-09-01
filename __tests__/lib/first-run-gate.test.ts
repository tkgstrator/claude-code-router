/**
 * 初回起動ゲートの契約。
 *
 * `ProtectedRoute` は「providers が 0 件」かつ「まだ提示していない」とき
 * `/setup` へ飛ばす。この2つ目の条件が実際に false へ倒れないと、
 * `/setup` の "Skip setup" が `/overview` へ遷移した直後にゲートが
 * 再評価して引き戻し、**押しても何も起きない**画面になる。
 * 実際 `markSetupOffered()` はどこからも呼ばれておらず、その状態で
 * 出荷されていた（`SetupScreen` のマウント時に呼ぶよう修正済み）。
 *
 * ストレージが使えないときに **`true`（提示済み）へ倒す**のも契約の一部。
 * 逆に倒すと、記憶できないブラウザではゲートが永久に閉じる。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isFreshInstall,
  isProviderConnected,
  markSetupOffered,
  setupAlreadyOffered
} from '../../src/components/rialto/system/first-run'
import type { Config, Provider } from '../../src/types'

// bun test にブラウザ環境は無いので、必要な2メソッドだけの最小実装を置く。
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

describe('setup の一度きりの提示', () => {
  test('最初は未提示', () => {
    expect(setupAlreadyOffered()).toBe(false)
  })

  test('mark すると提示済みになる —— これが無いと Skip setup が空振りする', () => {
    markSetupOffered()
    expect(setupAlreadyOffered()).toBe(true)
  })

  test('ストレージが使えないときは「提示済み」に倒す（ゲートを閉じ込めない）', () => {
    installStorage(throwingStorage())
    expect(setupAlreadyOffered()).toBe(true)
    // 書けなくても throw しない。失うのは nudge だけで、無害な向き。
    expect(() => markSetupOffered()).not.toThrow()
  })
})

describe('isFreshInstall', () => {
  const withProviders = (providers: Provider[]): Config => ({ Providers: providers }) as Config

  test('provider が1件も無いときだけ true', () => {
    expect(isFreshInstall(withProviders([]))).toBe(true)
    expect(isFreshInstall(withProviders([{ name: 'openai' }] as Provider[]))).toBe(false)
  })

  test('config 未取得（null）では判定しない', () => {
    // 読み込み中に /setup へ飛ばすと、実際には設定済みのインストールが
    // 一瞬だけ初回起動に見える。
    expect(isFreshInstall(null)).toBe(false)
  })
})

describe('isProviderConnected', () => {
  test('api_key: 空でないキーがあれば接続済み', () => {
    expect(isProviderConnected({ auth_mode: 'api_key', api_key: 'sk-x' } as Provider)).toBe(true)
    expect(isProviderConnected({ auth_mode: 'api_key', api_key: '' } as Provider)).toBe(false)
    expect(isProviderConnected({ auth_mode: 'api_key', api_key: null } as Provider)).toBe(false)
  })

  test('subscription: 有効なアカウントが1つでもあれば接続済み', () => {
    const sub = (accounts: Array<{ enabled: boolean }> | undefined): Provider =>
      ({ auth_mode: 'subscription', api_key: null, subscription_accounts: accounts }) as Provider
    expect(isProviderConnected(sub([{ enabled: true }]))).toBe(true)
    expect(isProviderConnected(sub([{ enabled: false }]))).toBe(false)
    // シードされただけの行。カタログに載っていても使えない。
    expect(isProviderConnected(sub([]))).toBe(false)
    expect(isProviderConnected(sub(undefined))).toBe(false)
  })
})
