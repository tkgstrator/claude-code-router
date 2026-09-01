/**
 * パリティ・マトリクス — gemini 列の共通原因（修正済み）。
 *
 * gemini 面の「tool use」「画像入力」「thinking」「system プロンプト」が
 * そろって欠けていたのは、それぞれ別々の取りこぼしだったからではなく
 * **`contents[]` の変換そのものが壊れていた**という単一の原因だった。
 * ここで一度だけ固定しておき、各行のテストはこのファイルを参照する。
 *
 * 原因は `GeminiInboundContentObjectSchema` が `text: z.string().default('')`
 * を宣言していたこと（src/schemas/wire/gemini/content.ts）。default が入る
 * ので `inboundContentToMessage` の `typeof content.text === 'string'` が
 * **常に真**になり、その下にある parts 分岐に決して到達しなかった。
 *
 * 修正は 2 段構え。default を外して `text` を本当に省略可能にし、さらに
 * 分岐順を「parts があれば parts → なければ text → どちらも無ければ捨てる」
 * に直した。片方だけだと、レガシーな `{ text }` 形と正規形のどちらかが
 * また黙って落ちる。
 *
 * 変換経路（gemini 面 → 非 Gemini プロバイダ）だけの話である点は変わらない。
 * Google プロバイダに当たる経路はパイプラインがバイパスに落ちるので
 * 素通しされ、この変換を通らない。
 */

import { describe, expect, test } from 'bun:test'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import type { TransformerContext } from '../../src/schemas/domain'

const ctx = {} as TransformerContext
const convert = (body: Record<string, unknown>) => new GeminiTransformer().transformRequestOut(body, ctx)

describe('gemini-generate — contents[] の変換', () => {
  test('対応済み: 正規ワイヤ形式 contents[].parts[].text が本文になる', async () => {
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
    })
    expect(unified.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
  })

  test('対応済み: role 省略は user 扱い（Gemini API の既定）', async () => {
    // Gemini では contents[].role は省略可で、省略時は user。以前は
    // role が user でも model でもない entry を null にして**メッセージごと
    // 捨てて**いたので、この形で組まれたリクエストは本文が丸ごと消えた。
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [{ parts: [{ text: 'hi' }] }]
    })
    expect(unified.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
  })

  test('対応済み: model ロールが assistant に写り、話者が入れ替わらない', async () => {
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

  test('対応済み: 文字列 contents は本文が残る（Gemini SDK は送らない形だが）', async () => {
    const unified = await convert({ model: 'gemini-3-pro', contents: ['hello'] })
    expect(unified.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  test('対応済み: レガシーな { text } 形も落ちない', async () => {
    // parts を読むようにしたあとも、parts の無い `{ text }` は text に
    // フォールバックする。default('') を外しただけだとこちらが `undefined`
    // になって消えるので、分岐順とセットで意味がある。
    const unified = await convert({ model: 'gemini-3-pro', contents: [{ text: 'hi' }] })
    expect(unified.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  test('空の parts / 空文字だけの entry はメッセージを作らない', async () => {
    // Gemini は本文の無いパートに `text: ''` を載せる。空の text ブロックを
    // 積むと、`TextContentSchema` が nonempty を要求する下流で弾かれる。
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [{ role: 'user', parts: [{ text: '' }] }, { role: 'user', parts: [] }]
    })
    expect(unified.messages).toEqual([])
  })

  test('対応済み: モデル名・stream は落ちない', async () => {
    // ルート層が URL から body に畳み込む二つのフィールドは無事なので、
    // ルーティングと JSON/SSE の分岐だけは gemini 面でも正しく効く。
    const unified = await convert({ model: 'gemini-3-pro', stream: true, contents: [] })
    expect(unified.model).toBe('gemini-3-pro')
    expect(unified.stream).toBe(true)
  })

  test('対応済み: generationConfig（maxOutputTokens / temperature）が読まれる', async () => {
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [],
      generationConfig: { maxOutputTokens: 512, temperature: 0.2 }
    })
    expect(unified.max_tokens).toBe(512)
    expect(unified.temperature).toBe(0.2)
  })

  test('generationConfig.temperature の 0 が既定値に化けない', async () => {
    // `||` フォールバックで書くと 0 が落ちる。Gemini クライアントが
    // 決定論的な出力を要求する典型がこの値なので、素通ししないと壊れる。
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [],
      generationConfig: { temperature: 0 }
    })
    expect(unified.temperature).toBe(0)
  })

  test('generation_config（snake_case）も読む', async () => {
    // Google の JSON マッピングは camelCase と proto の snake_case を
    // どちらも受ける。クライアント側の綴りで挙動が割れないようにする。
    const unified = await convert({
      model: 'gemini-3-pro',
      contents: [],
      generation_config: { maxOutputTokens: 256 }
    })
    expect(unified.max_tokens).toBe(256)
  })
})
