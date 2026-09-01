/**
 * パリティ・マトリクス — 行「エラー形式」。
 *
 * 面ごとにクライアント SDK がパースできる封筒が違う。Rialto は 1 本の
 * パイプラインで 4 種類の SDK を相手にしているので、**上流が何を返そうと
 * 面の封筒に詰め直す**必要がある——詰め直さないと、codex の `{detail}` が
 * OpenAI SDK に、Anthropic の `{type:'error'}` が Gemini SDK に、そのまま
 * 届く。
 *
 * 封筒そのものの語彙（error.type の分類、google.rpc.Code 名の対応表）は
 * `__tests__/api/error-shape.test.ts` が担保している。ここで見るのは
 * **面 → 封筒の対応が 4 面ぶん揃っていること**と、実際の実行経路である
 * `forwardUpstreamError` を通しても同じ封筒になること。
 */

import { describe, expect, test } from 'bun:test'
import { HTTPException } from 'hono/http-exception'
import { errorShapeForPath } from '../../src/api/v1/error-shape'
import { forwardUpstreamError } from '../../src/api/v1/upstream-error'
import { INBOUND_SURFACES } from '../../src/llms/inbound/surfaces'

// 上流の生エラー本文を、パイプラインが投げるのと同じ形の例外に包む。
// このメッセージ書式は provider-send.ts と PROVIDER_ERR_RE の間の契約。
const upstreamError = (status: number, rawBody: string): HTTPException =>
  new HTTPException(status as never, { message: `Error from provider(p,m: ${status}): ${rawBody}` })

// codex が実際に返す形。3 つの封筒のどれとも一致しないので、
// 詰め直しが効いているかどうかがはっきり出る。
const CODEX_BODY = JSON.stringify({ detail: 'Unsupported parameter: system' })

describe('4面すべてに封筒が割り当たっている', () => {
  test('記述子の errorShape と errorShapeForPath が一致する', () => {
    for (const surface of INBOUND_SURFACES) {
      expect(errorShapeForPath(surface.path.replace('/*', '/gemini-3-pro:generateContent'))).toBe(surface.errorShape)
    }
  })

  test('4面が 3 種類の封筒に割り当たっている（openai 面は 2 つで共有）', () => {
    expect(INBOUND_SURFACES.map((s) => `${s.id}:${s.errorShape}`)).toEqual([
      'anthropic-messages:anthropic',
      'openai-chat:openai',
      'openai-responses:openai',
      'gemini-generate:google'
    ])
  })
})

describe('上流の未知形式が面の封筒に詰め直される', () => {
  test('anthropic-messages — {type:"error", error:{type,message}}', async () => {
    const forwarded = forwardUpstreamError(upstreamError(400, CODEX_BODY), errorShapeForPath('/v1/messages'), 'p')
    expect(forwarded?.status).toBe(400)
    expect(await forwarded!.json()).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: '[via p] Unsupported parameter: system' }
    })
  })

  test('openai-chat — {error:{message,type,param,code}}', async () => {
    const forwarded = forwardUpstreamError(
      upstreamError(400, CODEX_BODY),
      errorShapeForPath('/v1/chat/completions'),
      'p'
    )
    expect(await forwarded!.json()).toEqual({
      error: { message: '[via p] Unsupported parameter: system', type: 'invalid_request_error', param: null, code: null }
    })
  })

  test('openai-responses — chat/completions と同じ封筒', async () => {
    const forwarded = forwardUpstreamError(upstreamError(400, CODEX_BODY), errorShapeForPath('/v1/responses'), 'p')
    expect(await forwarded!.json()).toEqual({
      error: { message: '[via p] Unsupported parameter: system', type: 'invalid_request_error', param: null, code: null }
    })
  })

  test('gemini-generate — google.rpc.Status（code は数値の HTTP ステータス）', async () => {
    const forwarded = forwardUpstreamError(
      upstreamError(400, CODEX_BODY),
      errorShapeForPath('/v1beta/models/gemini-3-pro:generateContent'),
      'p'
    )
    expect(await forwarded!.json()).toEqual({
      error: { code: 400, message: '[via p] Unsupported parameter: system', status: 'INVALID_ARGUMENT' }
    })
  })
})

describe('診断ヘッダは面によらず同じ', () => {
  test('via プロバイダと問い合わせ先 URL が付く（チェーン Rialto の切り分け用）', () => {
    const forwarded = forwardUpstreamError(upstreamError(401, '{"detail":"nope"}'), 'openai', 'p')
    expect(forwarded?.headers.get('x-rialto-upstream')).toBe('p')
  })

  test('パイプライン起因の例外は詰め直さず null を返す（呼び出し側が 5xx を出す）', () => {
    expect(forwardUpstreamError(new Error('boom'), 'openai', 'p')).toBeNull()
    expect(forwardUpstreamError(new HTTPException(500, { message: 'not the provider format' }), 'openai')).toBeNull()
  })
})
