/**
 * ベンダのモデル一覧エンドポイントから取れる情報を捨てていないか。
 *
 * Gemini のモデルは DB 上で **contextWindow が 55 件中 0 件**だった。
 * 原因は「取れなかった」ではなく「**捨てていた**」で、Google の
 * ListModels は最初から `inputTokenLimit` を返している。
 * `VendorModelsResponseSchema` が `name` しか宣言していなかったため、
 * 隣に載っていた上限が zod のパースで落ちていた。
 *
 * ここで固定するのは「レスポンスに上限があれば読む」ことである。
 */

import { describe, expect, test } from 'bun:test'
import { VendorModelsResponseSchema } from '../../src/schemas/api/models'
import { GenericProvider } from '../../src/vendors/generic'

describe('VendorModelsResponseSchema', () => {
  test('Google 形の inputTokenLimit を保持する', () => {
    const parsed = VendorModelsResponseSchema.safeParse({
      models: [{ name: 'models/gemini-2.5-flash', inputTokenLimit: 1048576, outputTokenLimit: 65536 }]
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.models?.[0]?.inputTokenLimit).toBe(1048576)
  })

  test('OpenAI 形の context_window を保持する', () => {
    const parsed = VendorModelsResponseSchema.safeParse({ data: [{ id: 'gpt-5', context_window: 400000 }] })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.data?.[0]?.context_window).toBe(400000)
  })

  test('上限を持たないレスポンスも通る', () => {
    // 上限は任意。宣言を足したせいで、載せていないベンダの一覧が
    // 丸ごと弾かれる、という壊れ方をしないこと。
    expect(VendorModelsResponseSchema.safeParse({ data: [{ id: 'gpt-5' }] }).success).toBe(true)
    expect(VendorModelsResponseSchema.safeParse({ models: [{ name: 'models/x' }] }).success).toBe(true)
  })
})

describe('既定の fetchContextWindows', () => {
  const withStubbedFetch = async <T>(payload: unknown, run: () => Promise<T>): Promise<T> => {
    const original = globalThis.fetch
    Reflect.set(globalThis, 'fetch', async () => new Response(JSON.stringify(payload), { status: 200 }))
    try {
      return await run()
    } finally {
      Reflect.set(globalThis, 'fetch', original)
    }
  }

  test('ListModels の inputTokenLimit を models/ 接頭辞を外して返す', async () => {
    const google = new GenericProvider('google')
    const got = await withStubbedFetch(
      {
        models: [
          { name: 'models/gemini-2.5-flash', inputTokenLimit: 1048576 },
          { name: 'models/gemini-2.5-flash-preview-tts', inputTokenLimit: 8192 }
        ]
      },
      () => google.fetchContextWindows(['gemini-2.5-flash', 'gemini-2.5-flash-preview-tts'], 'key')
    )
    expect(got.get('gemini-2.5-flash')).toBe(1048576)
    expect(got.get('gemini-2.5-flash-preview-tts')).toBe(8192)
  })

  test('呼び出し側が持っていない id は返さない', async () => {
    // 呼び出し側は返ってきた分だけ UPDATE する。行の無い id を混ぜると
    // 存在しない行への更新になる。
    const google = new GenericProvider('google')
    const got = await withStubbedFetch(
      { models: [{ name: 'models/gemini-2.5-flash', inputTokenLimit: 1 }, { name: 'models/unknown', inputTokenLimit: 2 }] },
      () => google.fetchContextWindows(['gemini-2.5-flash'], 'key')
    )
    expect([...got.keys()]).toEqual(['gemini-2.5-flash'])
  })

  test('api キーが無ければ何も返さない（上流を叩かない）', async () => {
    const google = new GenericProvider('google')
    expect((await google.fetchContextWindows(['gemini-2.5-flash'])).size).toBe(0)
    expect((await google.fetchContextWindows(['gemini-2.5-flash'], '  ')).size).toBe(0)
  })
})
