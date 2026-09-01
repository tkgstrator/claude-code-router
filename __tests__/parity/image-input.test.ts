/**
 * Parity matrix — the "image input" row.
 *
 * The internal representation is OpenAI's
 * `{ type: 'image_url', image_url: { url } }`, and each surface is
 * responsible for converging on it:
 *   - anthropic-messages : `{ type: 'image', source: { type:'base64'|'url', ... } }`
 *   - openai-chat        : already this shape, passed through
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

describe('anthropic-messages — supported', () => {
  test('a base64 image block becomes a data: URL', async () => {
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

  test('a url image block passes through as the URL', async () => {
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

describe('openai-chat — supported by passing through', () => {
  test('an image_url block is already the internal shape and is left alone', async () => {
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

describe('openai-responses — supported', () => {
  test('input_image becomes an image_url block', async () => {
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

describe('gemini-generate — supported', () => {
  test('inlineData and file_data parts become image_url blocks', async () => {
    // inlineData is rebuilt as a data: URL. `buildImagePart` in
    // `request-content.ts` splits on the comma to recover the base64, so
    // a gemini → gemini round trip returns the original shape.
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
    expect(urlsIn(userContent(unified.messages))).toEqual(['data:image/png;base64,AAAB', 'https://example.test/a.png'])
  })

  test('reads the camelCase spellings too (inlineData.mimeType / fileData.fileUri)', async () => {
    // This is what the Gemini SDK actually sends. Reading only one
    // spelling makes images survive or vanish depending on the client.
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
    expect(urlsIn(userContent(unified.messages))).toEqual(['data:image/jpeg;base64,BBBC', 'https://example.test/b.png'])
  })

  test('media_type survives into the internal representation', async () => {
    // The Anthropic outbound builds source.media_type from it. Keeping
    // only the URL means the image arrives with no type and 400s.
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
