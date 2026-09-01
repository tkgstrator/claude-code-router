/**
 * POST /v1/messages/count_tokens — Anthropic の事前サイズ見積り。
 *
 * Claude Code はこれで会話の圧縮タイミングを決める。実装が無いあいだは
 * `/v1/*` の fail-closed レーンが 404 を返しており、コンテキスト管理が
 * 黙って劣化していた（クライアントは上流が拒否するまで送り続ける）。
 *
 * ここで押さえているのは主に2点。**ルータと同じ数を返すこと**と、
 * **Rialto がモデル化していないツール形で 400 にしないこと**である。
 * 後者は実際に踏む: Claude Code のサーバーツール（`web_search_*`）は
 * `input_schema` を持たないので、素直に検証すると弾いてしまう。
 */

import { describe, expect, test } from 'bun:test'
import { countTokensRoute } from '../../src/api/v1/count-tokens'
import { CATALOG_PATHS } from '../../src/llms/inbound/surfaces'

const call = (body: unknown): Promise<Response> =>
  countTokensRoute.fetch(
    new Request('http://local/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  )

const countOf = async (body: unknown): Promise<number> => {
  const res = await call(body)
  expect(res.status).toBe(200)
  const json = (await res.json()) as { input_tokens: number }
  return json.input_tokens
}

describe('POST /v1/messages/count_tokens', () => {
  test('メッセージ本文を数える', async () => {
    const n = await countOf({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hello world' }]
    })
    expect(n).toBeGreaterThan(0)
  })

  test('本文が増えれば数も増える', async () => {
    const short = await countOf({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    const long = await countOf({
      model: 'm',
      messages: [{ role: 'user', content: 'lorem ipsum dolor sit amet '.repeat(200) }]
    })
    expect(long).toBeGreaterThan(short * 10)
  })

  test('system プロンプトも数に入る', async () => {
    const withoutSystem = await countOf({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    const withSystem = await countOf({
      model: 'm',
      system: 'You are a terse assistant that answers in one word.',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(withSystem).toBeGreaterThan(withoutSystem)
  })

  test('input_schema を持たないサーバーツールでも 400 にしない', async () => {
    // Claude Code が実際に送る形。ここで弾くと、上流なら通ったはずの
    // リクエストをプロキシが壊すことになる。
    const res = await call({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    })
    expect(res.status).toBe(200)
  })

  test('messages が無くても答える', async () => {
    // Anthropic 本家は 400 を返すが、ここで 500 になるほうが悪い。
    const res = await call({ model: 'm' })
    expect(res.status).toBe(200)
  })

  test('JSON オブジェクトでない body は Anthropic の封筒で 400', async () => {
    for (const body of ['[]', 'null', '"nope"', 'not json at all']) {
      const res = await call(body)
      expect(res.status).toBe(400)
      const json = (await res.json()) as { type: string; error: { type: string } }
      expect(json.type).toBe('error')
      expect(json.error.type).toBe('invalid_request_error')
    }
  })
})

describe('面レジストリへの登録', () => {
  test('CATALOG_PATHS に x-api-key + anthropic 封筒で載っている', async () => {
    // 完了系ではないので InboundSurface ではないが、認証ゲートと
    // エラー封筒はここから導出される。落とすと 401 が OpenAI 形で
    // 返り、Anthropic SDK が読めない本文になる。
    const entry = CATALOG_PATHS.find((p) => p.path === '/v1/messages/count_tokens')
    expect(entry).toBeDefined()
    expect(entry?.auth).toBe('x-api-key')
    expect(entry?.errorShape).toBe('anthropic')
  })

  test('ルータと同じ数を返す —— 数え方が2つに割れない', async () => {
    // このエンドポイントの存在理由の半分。longContext レーンは同じ
    // リクエストを同じレジストリで数えて振り分けるので、ここが違う数を
    // 返すと「まだ余裕がある」と信じた呼び出し側が、実際には長文レーンへ
    // 送られている、という食い違いが起きる。
    const { readSignals } = await import('../../src/llms/scenario-router/surface-signals')
    const { TokenizerRegistry } = await import('../../src/llms/registry/tokenizer')
    const pino = (await import('pino')).default

    const body = {
      model: 'claude-sonnet-5',
      system: 'be terse',
      messages: [{ role: 'user', content: 'lorem ipsum dolor sit amet '.repeat(50) }]
    }
    const tokenizers = new TokenizerRegistry(pino({ level: 'silent' }))
    await tokenizers.initialize()
    // scenario-router.ts の countRequestTokens と同じ経路。
    const viaRouter = await tokenizers.countTokens(readSignals(body, '/v1/messages').tokenize)

    expect(await countOf(body)).toBe(viaRouter.tokenCount)
  })
})
