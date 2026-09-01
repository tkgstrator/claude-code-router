/**
 * パリティ・マトリクス — シナリオ**レーン**の面パリティ。
 *
 * `routing-mode.test.ts` は「面ごとに routed / passthrough を選べるか」と
 * 「トークンが面の語彙で数えられるか」を見る。ここはその次の問い、
 * master-plan §Phase 2 の完了条件そのものを見る:
 * **routed にしたとき、その面は default 以外のレーンへ実際に落ちるのか。**
 *
 * これが以前は成り立っていなかった。モードは面ごとの設定値になったのに、
 * 分類器とルール述語は `body.thinking` / `body.output_config.effort` /
 * `tools[].type` という **Anthropic 語彙を直読み**していたので、他 3 面は
 * routed にしても永久に `default` へ落ちた。設定画面は嘘をついていない
 * が、その裏のレーンには道が無い、という状態だった。
 *
 * 各面のリクエストは**その面のクライアントが実際に送る綴り**で書く。
 * 正規化は `scenario-router/surface-signals.ts` の仕事であって、
 * テストが Anthropic 形に寄せてしまうと何も検証しないことになる。
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import pino from 'pino'
import { ConfigStore } from '../../src/llms/registry/config'
import { TokenizerRegistry } from '../../src/llms/registry/tokenizer'
import { routeScenario } from '../../src/llms/scenario-router'
import type { RouterRequest } from '../../src/llms/scenario-router/types'
import { __setSurfacesForTests } from '../../src/services/inbound-surface-service'

const log = pino({ level: 'silent' })

const PROVIDERS = [
  {
    name: 'anthropic',
    auth_mode: 'api_key' as const,
    api_key: 'sk-x',
    api_base_url: 'https://api.anthropic.com/v1/messages',
    models: ['claude-sonnet-5', 'claude-opus-4-7', 'claude-haiku-4-5']
  }
]

// Every lane gets a distinct target so a mis-classification shows up as
// the wrong model rather than as a passing test.
const ROUTER = {
  default: 'anthropic,claude-sonnet-5',
  agent: {
    default: 'anthropic,claude-sonnet-5',
    think: 'anthropic,claude-opus-4-7',
    webSearch: 'anthropic,claude-haiku-4-5',
    longContext: 'anthropic,claude-opus-4-7'
  }
}

async function run(path: string, body: Record<string, unknown>): Promise<RouterRequest> {
  const config = new ConfigStore({ Providers: PROVIDERS, providers: PROVIDERS, Router: ROUTER })
  const tokenizers = new TokenizerRegistry(log)
  await tokenizers.initialize()
  const req: RouterRequest = {
    body: { model: 'caller,own-model', ...body } as RouterRequest['body'],
    log,
    inboundPath: path
  }
  await routeScenario(req, { config, tokenizers })
  return req
}

const PATHS = {
  'anthropic-messages': '/v1/messages',
  'openai-chat': '/v1/chat/completions',
  'openai-responses': '/v1/responses',
  'gemini-generate': '/v1beta/models/gemini-3-pro:generateContent'
} as const

beforeEach(() => {
  __setSurfacesForTests({
    'anthropic-messages': 'routed',
    'openai-chat': 'routed',
    'openai-responses': 'routed',
    'gemini-generate': 'routed'
  })
})

describe('think レーンに 4 面すべてから到達できる', () => {
  // 同じ意図（拡張思考を要求する）を、面ごとの綴りで書く。
  const THINKING: Record<keyof typeof PATHS, Record<string, unknown>> = {
    'anthropic-messages': { thinking: { type: 'enabled', budget_tokens: 4096 } },
    'openai-chat': { reasoning_effort: 'high' },
    'openai-responses': { reasoning: { effort: 'high' } },
    'gemini-generate': { generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } }
  }

  for (const [id, path] of Object.entries(PATHS)) {
    test(`${id}`, async () => {
      const req = await run(path, THINKING[id as keyof typeof PATHS])
      expect(req.scenarioType).toBe('think')
      expect(req.body.model).toBe('anthropic,claude-opus-4-7')
    })
  }
})

describe('webSearch レーンに 4 面すべてから到達できる', () => {
  // web 検索ツールの綴りはベンダごとに違う。glob ではなく意味で判定して
  // いることを、実際の綴りで確かめる。
  const WEB_SEARCH: Record<keyof typeof PATHS, Record<string, unknown>> = {
    'anthropic-messages': { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
    'openai-chat': { tools: [{ type: 'web_search_preview' }] },
    'openai-responses': { tools: [{ type: 'web_search_preview' }] },
    'gemini-generate': { tools: [{ googleSearch: {} }] }
  }

  for (const [id, path] of Object.entries(PATHS)) {
    test(`${id}`, async () => {
      const req = await run(path, WEB_SEARCH[id as keyof typeof PATHS])
      expect(req.scenarioType).toBe('webSearch')
      expect(req.body.model).toBe('anthropic,claude-haiku-4-5')
    })
  }
})

describe('シグナルが無ければ 4 面とも default に落ちる', () => {
  // 逆方向の担保。上の 2 つが「何を送っても think になる」で通って
  // しまわないことを見る。
  const PLAIN: Record<keyof typeof PATHS, Record<string, unknown>> = {
    'anthropic-messages': { messages: [{ role: 'user', content: 'hi' }] },
    'openai-chat': { messages: [{ role: 'user', content: 'hi' }] },
    'openai-responses': { input: 'hi' },
    'gemini-generate': { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }
  }

  for (const [id, path] of Object.entries(PATHS)) {
    test(`${id}`, async () => {
      const req = await run(path, PLAIN[id as keyof typeof PATHS])
      expect(req.scenarioType).toBe('default')
      expect(req.body.model).toBe('anthropic,claude-sonnet-5')
    })
  }
})

describe('webSearch は think より優先される（面をまたいで順序が同じ）', () => {
  // 分類器の分岐順は 4 面で共有されている。面ごとに順序が割れていないこと
  // を、両方のシグナルを同時に立てて確かめる。
  const BOTH: Record<keyof typeof PATHS, Record<string, unknown>> = {
    'anthropic-messages': {
      thinking: { type: 'enabled', budget_tokens: 4096 },
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    },
    'openai-chat': { reasoning_effort: 'high', tools: [{ type: 'web_search_preview' }] },
    'openai-responses': { reasoning: { effort: 'high' }, tools: [{ type: 'web_search_preview' }] },
    'gemini-generate': {
      generationConfig: { thinkingConfig: { thinkingLevel: 'high' } },
      tools: [{ googleSearch: {} }]
    }
  }

  for (const [id, path] of Object.entries(PATHS)) {
    test(`${id}`, async () => {
      const req = await run(path, BOTH[id as keyof typeof PATHS])
      expect(req.scenarioType).toBe('webSearch')
    })
  }
})
