/**
 * Integration tests for the openai provider.
 * Requires OPENAI_API_KEY environment variable to be set.
 * Rialto must be running at http://127.0.0.1:3456.
 */

import { describe, expect, test } from 'bun:test'
import {
  assertAnthropicSSEShape,
  extractTextFromEvents,
  IS_REPLAY,
  isUnavailableModelSignal,
  type SSEEvent,
  sendMessage,
  streamMessage,
  TEST_TIMEOUT
} from './helpers'

// In replay mode the upstream key is irrelevant — fixtures supply the
// response. Skip only when we'd actually hit the live server and the
// caller hasn't provisioned credentials (or has opted out explicitly).
const hasApiKey = IS_REPLAY || (Boolean(process.env.OPENAI_API_KEY) && !process.env.RIALTO_SKIP_LIVE_TESTS)

describe.skipIf(!hasApiKey)('openai / gpt-4.1-mini', () => {
  test(
    'streaming response has correct Anthropic SSE shape',
    async () => {
      const events = await streamMessage({
        model: 'openai,gpt-4.1-mini',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Say exactly: hello' }]
      })

      assertAnthropicSSEShape(events)
      const text = extractTextFromEvents(events)
      expect(text.length).toBeGreaterThan(0)
    },
    TEST_TIMEOUT
  )

  test(
    'response contains expected text',
    async () => {
      const events = await streamMessage({
        model: 'openai,gpt-4.1-mini',
        max_tokens: 50,
        messages: [{ role: 'user', content: "Reply with the word 'pong' only." }]
      })

      const text = extractTextFromEvents(events)
      expect(text.toLowerCase()).toContain('pong')
    },
    TEST_TIMEOUT
  )

  test(
    'non-streaming response returns Anthropic message format',
    async () => {
      const res = await sendMessage({
        model: 'openai,gpt-4.1-mini',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Reply with only the number 42.' }],
        stream: false
      })

      expect(res.ok).toBe(true)
      const body = (await res.json()) as any
      expect(body.type).toBe('message')
      expect(body.role).toBe('assistant')
      expect(Array.isArray(body.content)).toBe(true)
      const text = body.content.map((c: any) => c.text ?? '').join('')
      expect(text).toContain('42')
    },
    TEST_TIMEOUT
  )
})

describe.skipIf(!hasApiKey)('openai / gpt-4.1', () => {
  test(
    'streaming response has correct Anthropic SSE shape',
    async () => {
      const events = await streamMessage({
        model: 'openai,gpt-4.1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Say exactly: hello' }]
      })

      assertAnthropicSSEShape(events)
      const text = extractTextFromEvents(events)
      expect(text.length).toBeGreaterThan(0)
    },
    TEST_TIMEOUT
  )
})

describe.skipIf(!hasApiKey)('openai / gpt-5.5', () => {
  test(
    'streaming response has correct Anthropic SSE shape',
    async () => {
      let events: SSEEvent[] | undefined
      try {
        events = await streamMessage({
          model: 'openai,gpt-5.5',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Say exactly: hello' }]
        })
      } catch (err: any) {
        if (isUnavailableModelSignal(err.message)) {
          console.warn('openai gpt-5.5 not available, skipping')
          return
        }
        throw err
      }

      assertAnthropicSSEShape(events)
      const text = extractTextFromEvents(events)
      expect(text.length).toBeGreaterThan(0)
    },
    TEST_TIMEOUT
  )

  test(
    'response contains expected text',
    async () => {
      let events: SSEEvent[] | undefined
      try {
        events = await streamMessage({
          model: 'openai,gpt-5.5',
          max_tokens: 50,
          messages: [{ role: 'user', content: "Reply with the word 'pong' only." }]
        })
      } catch (err: any) {
        if (isUnavailableModelSignal(err.message)) {
          console.warn('openai gpt-5.5 not available, skipping')
          return
        }
        throw err
      }

      const text = extractTextFromEvents(events)
      expect(text.toLowerCase()).toContain('pong')
    },
    TEST_TIMEOUT
  )
})

describe.skipIf(!hasApiKey)('openai / gpt-5.4', () => {
  test(
    'streaming response has correct Anthropic SSE shape',
    async () => {
      let events: SSEEvent[] | undefined
      try {
        events = await streamMessage({
          model: 'openai,gpt-5.4',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Say exactly: hello' }]
        })
      } catch (err: any) {
        if (isUnavailableModelSignal(err.message)) {
          console.warn('openai gpt-5.4 not available, skipping')
          return
        }
        throw err
      }

      assertAnthropicSSEShape(events)
      const text = extractTextFromEvents(events)
      expect(text.length).toBeGreaterThan(0)
    },
    TEST_TIMEOUT
  )

  test(
    'response contains expected text',
    async () => {
      let events: SSEEvent[] | undefined
      try {
        events = await streamMessage({
          model: 'openai,gpt-5.4',
          max_tokens: 50,
          messages: [{ role: 'user', content: "Reply with the word 'pong' only." }]
        })
      } catch (err: any) {
        if (isUnavailableModelSignal(err.message)) {
          console.warn('openai gpt-5.4 not available, skipping')
          return
        }
        throw err
      }

      const text = extractTextFromEvents(events)
      expect(text.toLowerCase()).toContain('pong')
    },
    TEST_TIMEOUT
  )

  test(
    'non-streaming response returns Anthropic message format',
    async () => {
      let res: Response | undefined
      try {
        res = await sendMessage({
          model: 'openai,gpt-5.4',
          max_tokens: 50,
          messages: [{ role: 'user', content: 'Reply with only the number 42.' }],
          stream: false
        })
      } catch (err: any) {
        if (isUnavailableModelSignal(err.message)) {
          console.warn('openai gpt-5.4 not available, skipping')
          return
        }
        throw err
      }

      if (!res.ok) {
        const text = await res.text()
        if (isUnavailableModelSignal(text)) {
          console.warn('openai gpt-5.4 not available, skipping')
          return
        }
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const body = (await res.json()) as any
      expect(body.type).toBe('message')
      expect(body.role).toBe('assistant')
      expect(Array.isArray(body.content)).toBe(true)
      const text = body.content.map((c: any) => c.text ?? '').join('')
      expect(text).toContain('42')
    },
    TEST_TIMEOUT
  )
})

describe.skipIf(!hasApiKey)('openai / gpt-5.3-codex', () => {
  test(
    'streaming response has correct Anthropic SSE shape',
    async () => {
      let events: SSEEvent[] | undefined
      try {
        events = await streamMessage({
          model: 'openai,gpt-5.3-codex',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Say exactly: hello' }]
        })
      } catch (err: any) {
        if (isUnavailableModelSignal(err.message)) {
          console.warn('openai gpt-5.3-codex not available, skipping')
          return
        }
        throw err
      }

      assertAnthropicSSEShape(events)
      const text = extractTextFromEvents(events)
      expect(text.length).toBeGreaterThan(0)
    },
    TEST_TIMEOUT
  )

  test(
    'response contains expected text',
    async () => {
      let events: SSEEvent[] | undefined
      try {
        events = await streamMessage({
          model: 'openai,gpt-5.3-codex',
          max_tokens: 50,
          messages: [{ role: 'user', content: "Reply with the word 'pong' only." }]
        })
      } catch (err: any) {
        if (isUnavailableModelSignal(err.message)) {
          console.warn('openai gpt-5.3-codex not available, skipping')
          return
        }
        throw err
      }

      const text = extractTextFromEvents(events)
      expect(text.toLowerCase()).toContain('pong')
    },
    TEST_TIMEOUT
  )
})
