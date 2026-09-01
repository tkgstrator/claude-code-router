/**
 * That nothing a vendor's model-list endpoint offers gets thrown away.
 *
 * The Gemini models had **a contextWindow on 0 of 55 rows** in the DB.
 * The cause was not that the limit could not be fetched but that it was
 * **being discarded**: Google's ListModels has returned
 * `inputTokenLimit` all along. `VendorModelsResponseSchema` declared only
 * `name`, so the limit sitting right beside it was dropped in the zod
 * parse.
 *
 * What is pinned here is that a limit present in the response is read.
 */

import { describe, expect, test } from 'bun:test'
import { VendorModelsResponseSchema } from '../../src/schemas/api/models'
import { GenericProvider } from '../../src/vendors/generic'

describe('VendorModelsResponseSchema', () => {
  test('keeps inputTokenLimit in the Google shape', () => {
    const parsed = VendorModelsResponseSchema.safeParse({
      models: [{ name: 'models/gemini-2.5-flash', inputTokenLimit: 1048576, outputTokenLimit: 65536 }]
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.models?.[0]?.inputTokenLimit).toBe(1048576)
  })

  test('keeps context_window in the OpenAI shape', () => {
    const parsed = VendorModelsResponseSchema.safeParse({ data: [{ id: 'gpt-5', context_window: 400000 }] })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.data?.[0]?.context_window).toBe(400000)
  })

  test('a response with no limit still parses', () => {
    // The limit is optional. Adding the declaration must not break the
    // whole listing for a vendor that does not publish one.
    expect(VendorModelsResponseSchema.safeParse({ data: [{ id: 'gpt-5' }] }).success).toBe(true)
    expect(VendorModelsResponseSchema.safeParse({ models: [{ name: 'models/x' }] }).success).toBe(true)
  })
})

describe('the default fetchContextWindows', () => {
  const withStubbedFetch = async <T>(payload: unknown, run: () => Promise<T>): Promise<T> => {
    const original = globalThis.fetch
    Reflect.set(globalThis, 'fetch', async () => new Response(JSON.stringify(payload), { status: 200 }))
    try {
      return await run()
    } finally {
      Reflect.set(globalThis, 'fetch', original)
    }
  }

  test('returns ListModels inputTokenLimit with the models/ prefix stripped', async () => {
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

  test('does not return an id the caller did not ask about', async () => {
    // The caller UPDATEs exactly what comes back. An id with no row
    // would become an update against a row that does not exist.
    const google = new GenericProvider('google')
    const got = await withStubbedFetch(
      {
        models: [
          { name: 'models/gemini-2.5-flash', inputTokenLimit: 1 },
          { name: 'models/unknown', inputTokenLimit: 2 }
        ]
      },
      () => google.fetchContextWindows(['gemini-2.5-flash'], 'key')
    )
    expect([...got.keys()]).toEqual(['gemini-2.5-flash'])
  })

  test('returns nothing without an api key, and does not call upstream', async () => {
    const google = new GenericProvider('google')
    expect((await google.fetchContextWindows(['gemini-2.5-flash'])).size).toBe(0)
    expect((await google.fetchContextWindows(['gemini-2.5-flash'], '  ')).size).toBe(0)
  })
})
