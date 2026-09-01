/**
 * パリティ・マトリクス — 行「画像入力」。
 *
 * 内部表現は OpenAI の `{ type: 'image_url', image_url: { url } }`。
 * 各面はここへ寄せる責任がある:
 *   - anthropic-messages : `{ type: 'image', source: { type:'base64'|'url', ... } }`
 *   - openai-chat        : すでに同形（素通し）
 *   - openai-responses   : `{ type: 'input_image', image_url }`
 *   - gemini-generate    : `{ inlineData: { mime_type, data } }` / `{ file_data: ... }`
 */

import { describe, expect, test } from 'bun:test'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAIResponsesTransformer, OpenAITransformer } from '../../src/llms/transformers/openai'
import type { TransformerContext } from '../../src/schemas/domain'

const ctx = {} as TransformerContext

const userContent = (messages: unknown): unknown => {
  if (!Array.isArray(messages)) return undefined
  const user = messages.find((m) => Reflect.get(Object(m), 'role') === 'user')
  return user === undefined ? undefined : Reflect.get(Object(user), 'content')
}

const urlsIn = (content: unknown): unknown[] =>
  Array.isArray(content)
    ? content
        .filter((b) => Reflect.get(Object(b), 'type') === 'image_url')
        .map((b) => Reflect.get(Object(Reflect.get(Object(b), 'image_url')), 'url'))
    : []

describe('anthropic-messages — 対応済み', () => {
  test('base64 の image ブロックが data: URL になる', async () => {
    const unified = await new AnthropicTransformer().transformRequestOut(
      {
        model: 'm',
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this?' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAB' } }
            ]
          }
        ]
      },
      ctx
    )
    expect(urlsIn(userContent(unified.messages))).toEqual(['data:image/png;base64,AAAB'])
  })

  test('url の image ブロックは URL のまま渡る', async () => {
    const unified = await new AnthropicTransformer().transformRequestOut(
      {
        model: 'm',
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', media_type: 'image/png', url: 'https://example.test/a.png' } }
            ]
          }
        ]
      },
      ctx
    )
    expect(urlsIn(userContent(unified.messages))).toEqual(['https://example.test/a.png'])
  })
})

describe('openai-chat — 対応済み（素通し）', () => {
  test('image_url ブロックは内部表現と同形なので触られない', async () => {
    const unified = await new OpenAITransformer().transformRequestOut(
      {
        model: 'm',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this?' },
              { type: 'image_url', image_url: { url: 'https://example.test/a.png' } }
            ]
          }
        ]
      },
      ctx
    )
    expect(urlsIn(userContent(unified.messages))).toEqual(['https://example.test/a.png'])
  })
})

describe('openai-responses — 対応済み', () => {
  test('input_image が image_url ブロックになる', async () => {
    const unified = await new OpenAIResponsesTransformer().transformRequestOut(
      {
        model: 'm',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'what is this?' },
              { type: 'input_image', image_url: 'https://example.test/a.png' }
            ]
          }
        ]
      },
      ctx
    )
    expect(urlsIn(userContent(unified.messages))).toEqual(['https://example.test/a.png'])
  })
})

describe('gemini-generate — 対応済み', () => {
  test('inlineData / file_data パートが image_url ブロックになる', async () => {
    // inlineData は data: URL に組み直す。`request-content.ts` の
    // `buildImagePart` がカンマで割って base64 に戻すので、
    // gemini → gemini の往復で元の形に返る。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'what is this?' },
              { inlineData: { mime_type: 'image/png', data: 'AAAB' } },
              { file_data: { mime_type: 'image/png', file_uri: 'https://example.test/a.png' } }
            ]
          }
        ]
      },
      ctx
    )
    expect(urlsIn(userContent(unified.messages))).toEqual([
      'data:image/png;base64,AAAB',
      'https://example.test/a.png'
    ])
  })

  test('camelCase の綴り（inlineData.mimeType / fileData.fileUri）も読む', async () => {
    // Gemini の SDK が実際に送るのはこちら。片方しか読まないと、
    // クライアントの実装によって画像が消えたり消えなかったりする。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: 'BBBC' } },
              { fileData: { mimeType: 'image/png', fileUri: 'https://example.test/b.png' } }
            ]
          }
        ]
      },
      ctx
    )
    expect(urlsIn(userContent(unified.messages))).toEqual([
      'data:image/jpeg;base64,BBBC',
      'https://example.test/b.png'
    ])
  })

  test('media_type が内部表現に残る', async () => {
    // Anthropic outbound は media_type から source.media_type を組む。
    // URL だけ拾って捨てると、画像が届いても型が分からず 400 になる。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/webp', data: 'CCCD' } }] }]
      },
      ctx
    )
    const blocks = userContent(unified.messages)
    expect(Array.isArray(blocks) ? Reflect.get(Object(blocks[0]), 'media_type') : undefined).toBe('image/webp')
  })
})
