/**
 * Parity matrix — the common cause behind the gemini column (fixed).
 *
 * "tool use", "image input", "thinking" and "system prompt" were all
 * missing on the gemini surface not as four separate oversights but from
 * one cause: **the `contents[]` conversion itself was broken**. It is
 * pinned once here, and each row's own test refers back to this file.
 *
 * The cause was `GeminiInboundContentObjectSchema` declaring
 * `text: z.string().default('')` (src/schemas/wire/gemini/content.ts).
 * With the default applied, `typeof content.text === 'string'` in
 * `inboundContentToMessage` was **always true** and the parts branch
 * below it was never reached.
 *
 * The fix has two halves: drop the default so `text` is genuinely
 * optional, and reorder the branches to "parts if present, else text,
 * else discard". Either half alone leaves one of the legacy `{ text }`
 * form and the canonical form silently dropping again.
 *
 * This still concerns only the conversion path (gemini surface → a
 * non-Gemini provider). A request bound for a Google provider takes the
 * pipeline's bypass and is passed through without this conversion.
 */

import { describe, expect, test } from 'bun:test'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import type { TransformerContext } from '../../src/schemas/domain'

const ctx = {} as TransformerContext
const convert = (body: Record<string, unknown>) => new GeminiTransformer().transformRequestOut(body, ctx)

describe('gemini-generate — converting contents[]', () => {
  test('supported: the canonical wire form contents[].parts[].text becomes the body', async () => {
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
    })
    expect(unified.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
  })

  test('supported: a missing role means user, the Gemini API default', async () => {
    // contents[].role is optional in Gemini and defaults to user. This
    // used to null out any entry whose role was neither user nor model
    // and **discard the whole message**, so a request built this way lost
    // its body entirely.
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [{ parts: [{ text: 'hi' }] }]
    })
    expect(unified.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
  })

  test('supported: the model role maps to assistant, so the speakers do not swap', async () => {
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [
        { role: 'user', parts: [{ text: 'q' }] },
        { role: 'model', parts: [{ text: 'a' }] }
      ]
    })
    expect(unified.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] }
    ])
  })

  test('supported: a string contents keeps its body, though no Gemini SDK sends this', async () => {
    const unified = await convert({ model: 'gemini-3-pro', contents: ['hello'] })
    expect(unified.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  test('supported: the legacy { text } form is not dropped either', async () => {
    // Even after parts became the primary read, a `{ text }` with no
    // parts falls back to text. Removing default('') alone would make
    // this `undefined` and lose it, which is why the branch order comes
    // with it.
    const unified = await convert({ model: 'gemini-3-pro', contents: [{ text: 'hi' }] })
    expect(unified.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  test('empty parts, or an entry holding only an empty string, produces no message', async () => {
    // Gemini puts `text: ''` on a part with no body. Emitting an empty
    // text block gets rejected downstream, where `TextContentSchema`
    // requires nonempty.
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [
        { role: 'user', parts: [{ text: '' }] },
        { role: 'user', parts: [] }
      ]
    })
    expect(unified.messages).toEqual([])
  })

  test('supported: the model name and stream flag survive', async () => {
    // The two fields the route layer folds from the URL into the body are
    // intact, so routing and the JSON/SSE branch at least work correctly
    // on the gemini surface.
    const unified = await convert({ model: 'gemini-3-pro', stream: true, contents: [] })
    expect(unified.model).toBe('gemini-3-pro')
    expect(unified.stream).toBe(true)
  })

  test('supported: generationConfig (maxOutputTokens / temperature) is read', async () => {
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [],
      generationConfig: { maxOutputTokens: 512, temperature: 0.2 }
    })
    expect(unified.max_tokens).toBe(512)
    expect(unified.temperature).toBe(0.2)
  })

  test('a generationConfig.temperature of 0 does not turn into the default', async () => {
    // Written with a `||` fallback, 0 is lost. It is the canonical value
    // a Gemini client sends to ask for deterministic output, so it has to
    // pass through.
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [],
      generationConfig: { temperature: 0 }
    })
    expect(unified.temperature).toBe(0)
  })

  test('reads snake_case generation_config too', async () => {
    // Google's JSON mapping accepts both camelCase and the proto's
    // snake_case. Behaviour must not fork on which spelling a client
    // picks.
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [],
      generation_config: { maxOutputTokens: 256 }
    })
    expect(unified.max_tokens).toBe(256)
  })
})
