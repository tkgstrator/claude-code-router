/**
 * Integration tests for the claude-code subscription provider
 * (Anthropic via Claude Code OAuth credentials).
 *
 * Requires ~/.claude/.credentials.json to be present and the Rialto server
 * running (default http://127.0.0.1:16173, override with RIALTO_TEST_URL).
 *
 * Every *enabled* model of every claude-* subscription provider in
 * /api/config is smoke-tested, so the matrix tracks the DB instead of a
 * hardcoded list. smokeSubscriptionModel asserts HTTP 200 + a valid
 * Anthropic SSE shape, hard-fails a long-context 429 (the regression
 * guard for the context-1m beta strip), and tolerates only a sustained
 * free-tier quota 429.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  fetchSubscriptionModels,
  IS_REPLAY,
  type SubscriptionModel,
  smokeSubscriptionModel,
  TEST_TIMEOUT
} from './helpers'

const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json')
// Replay mode doesn't need real OAuth creds — fixtures supply the
// subscription smokes.
const hasCredentials = IS_REPLAY || (existsSync(CREDENTIALS_PATH) && !process.env.RIALTO_SKIP_LIVE_TESTS)

const result = await (async (): Promise<{ models: SubscriptionModel[] } | { error: string }> => {
  if (!hasCredentials) return { models: [] }
  try {
    return { models: await fetchSubscriptionModels(/claude/i) }
  } catch (e) {
    return { error: (e as Error).message }
  }
})()

describe.skipIf(!hasCredentials)('claude-code subscription / all enabled models', () => {
  if ('error' in result) {
    test('Rialto server reachable for /api/config', () => {
      throw new Error(`Could not load model matrix from Rialto — is the server running? ${result.error}`)
    })
    return
  }

  if (result.models.length === 0) {
    test('at least one enabled claude-code subscription model', () => {
      throw new Error('No enabled claude-* subscription models in /api/config — nothing to verify')
    })
    return
  }

  for (const { provider, model } of result.models) {
    describe(`${provider},${model}`, () => {
      test(
        'HTTP 200 + valid Anthropic SSE with text',
        async () => {
          const text = await smokeSubscriptionModel(`${provider},${model}`)
          expect(text.length).toBeGreaterThan(0)
        },
        TEST_TIMEOUT
      )
    })
  }
})
