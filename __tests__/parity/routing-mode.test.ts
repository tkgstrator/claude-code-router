/**
 * パリティ・マトリクス — ルーティングそのものの面パリティ。
 *
 * マトリクスの 10 行はどれも「面が機能を表現できるか」を見るが、
 * その手前に「そもそも面ごとにルーティングを効かせられるか」がある
 * （master-plan §2-5 の完了条件その2）。以前はこれが
 * `scenario-router.ts` に直書きされていて、/v1/messages 以外は無条件に
 * 素通しだった——つまりルーティング画面はすべて /v1/messages 専用画面
 * だった。今はモードが面ごとの設定値なので、4 面が対称に振る舞う。
 *
 * 対称でない点が 2 つ残っていて、どちらも意図的:
 *   - persona 注入は /v1/messages 限定（他面ではトップレベル `system` が
 *     未知フィールドとして 400 になる上流がある）
 *   - longContext のトークン計数は `body.messages` を読むので、
 *     Responses / Gemini の語彙では常に 0 になる
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import pino from 'pino'
import type { SurfaceId } from '../../src/llms/inbound/surfaces'
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
    models: ['claude-sonnet-5']
  }
]

const ROUTER = {
  default: 'anthropic,claude-sonnet-5',
  agent: { default: 'anthropic,claude-sonnet-5' },
  agentFallbacks: { default: ['anthropic,claude-sonnet-5'] }
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

const SURFACES: ReadonlyArray<[SurfaceId, string]> = [
  ['anthropic-messages', '/v1/messages'],
  ['openai-chat', '/v1/chat/completions'],
  ['openai-responses', '/v1/responses'],
  ['gemini-generate', '/v1beta/models/gemini-3-pro:generateContent']
]

// モードはモジュールスコープのキャッシュに載るので、前後どちらでも
// 戻しておく。他のテストファイルと同じプロセスで走る以上、後始末を
// 怠ると「なぜかルーティングが効いている」隣のテストを作ってしまう。
beforeEach(() => {
  __setSurfacesForTests({})
})

afterEach(() => {
  __setSurfacesForTests({})
})

describe('モードが 4 面すべてで効く', () => {
  for (const [id, path] of SURFACES) {
    test(`${id} — routed にするとルータの primary に書き換わる`, async () => {
      __setSurfacesForTests({ [id]: 'routed' })
      const req = await run(path, { messages: [{ role: 'user', content: 'hi' }] })
      expect(req.body.model).toBe('anthropic,claude-sonnet-5')
      expect(req.resolvedFallbacks).toEqual(['anthropic,claude-sonnet-5'])
    })

    test(`${id} — passthrough にすると呼び出し側のモデルが残り、チェーンも空`, async () => {
      __setSurfacesForTests({ [id]: 'passthrough' })
      const req = await run(path, { messages: [{ role: 'user', content: 'hi' }] })
      expect(req.body.model).toBe('caller,own-model')
      expect(req.resolvedFallbacks).toEqual([])
    })
  }

  test('モードは面ごとに独立している（1 面を routed にしても他面は素通し）', async () => {
    __setSurfacesForTests({ 'anthropic-messages': 'routed' })
    const routed = await run('/v1/messages', { messages: [{ role: 'user', content: 'hi' }] })
    const untouched = await run('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] })
    expect(routed.body.model).toBe('anthropic,claude-sonnet-5')
    expect(untouched.body.model).toBe('caller,own-model')
  })
})

describe('意図的な非対称', () => {
  test('persona 注入は /v1/messages 限定', async () => {
    // OpenAI 互換の面にトップレベル `system` を足すと、上流（codex が
    // 代表例）が未知パラメータとして 400 を返す。だから注入しない。
    __setSurfacesForTests({ 'anthropic-messages': 'routed', 'openai-chat': 'routed' })
    const anthropic = await run('/v1/messages', { messages: [{ role: 'user', content: 'hi' }] })
    const openai = await run('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] })
    // persona 未設定でもフィールドの有無に差が出る: /v1/messages だけ
    // applyGlobalSystemPrompt を通る。
    expect('system' in anthropic.body).toBe(true)
    expect('system' in openai.body).toBe(false)
  })

  test('未対応: longContext のトークン計数が Responses / Gemini の語彙を読めない', async () => {
    // `countRequestTokens` が読むのは body.messages / body.system /
    // body.tools。Responses は `input` / `instructions`、Gemini は
    // `contents` に本文を置くので、どれだけ長い会話でも 0 と数えられ、
    // longContext レーンへ入る道がない。計数が面の語彙を理解するように
    // なったらこの期待値を反転させ、inbound-parity.md も更新すること。
    __setSurfacesForTests({
      'anthropic-messages': 'routed',
      'openai-chat': 'routed',
      'openai-responses': 'routed',
      'gemini-generate': 'routed'
    })
    const long = 'lorem ipsum dolor sit amet '.repeat(200)

    const anthropic = await run('/v1/messages', { messages: [{ role: 'user', content: long }] })
    const chat = await run('/v1/chat/completions', { messages: [{ role: 'user', content: long }] })
    const responses = await run('/v1/responses', { input: long, instructions: 'be terse' })
    const gemini = await run('/v1beta/models/gemini-3-pro:generateContent', {
      contents: [{ role: 'user', parts: [{ text: long }] }]
    })

    expect(anthropic.tokenCount).toBeGreaterThan(0)
    expect(chat.tokenCount).toBeGreaterThan(0)
    expect(responses.tokenCount).toBe(0)
    expect(gemini.tokenCount).toBe(0)
  })
})
