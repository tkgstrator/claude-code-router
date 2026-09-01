/**
 * Provider.models の並びが安定していること。
 *
 * Providers 画面のモデル表は `provider.models` の配列順をそのまま描く。
 * その配列は Prisma のリレーションから来ていて、**`orderBy` が無かった**。
 * リレーションに順序指定が無いと Postgres は好きな順で返すので、モデルを
 * 1つトグルした UPDATE が行の物理位置を動かし、**操作した瞬間に表が
 * 並び替わる**という形で現れていた。
 *
 * 同じ `include` の `subscriptionAccounts` には最初から `orderBy` が
 * 付いていた——一度は気づいて片方だけ直した跡である。
 *
 * ここで見るのは「何順か」ではなく「**同じ入力なら同じ順**」であること。
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { getPrismaClient } from '../../src/db/client'
import { applyUiConfig, composeUiConfig, ensureRouterSlots } from '../../src/services/config'
import { HAS_DB, resetDbTables, teardownPrisma } from './helpers'

const MODELS = ['gpt-5', 'gpt-5-mini', 'gpt-4o', 'o3', 'gpt-5-nano']

const seed = (enabledOff: string[] = []): Parameters<typeof applyUiConfig>[0] => ({
  Providers: [
    {
      name: 'openai',
      api_base_url: 'https://api.openai.com/v1',
      api_key: 'sk-x',
      auth_mode: 'api_key',
      models: MODELS,
      ...(enabledOff.length > 0 ? { transformer: { _disabledModels: enabledOff } } : {})
    }
  ]
})

const modelOrder = async (): Promise<string[]> => {
  const ui = await composeUiConfig()
  const p = ui.Providers.find((x) => x.name === 'openai')
  if (p === undefined) throw new Error('openai provider missing')
  return p.models
}

describe.skipIf(!HAS_DB)('Provider.models の並び', () => {
  beforeEach(async () => {
    await resetDbTables()
    await ensureRouterSlots()
    await applyUiConfig(seed())
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('続けて読んでも同じ順で返る', async () => {
    const first = await modelOrder()
    expect(await modelOrder()).toEqual(first)
    expect(await modelOrder()).toEqual(first)
  })

  test('モデルを1つ無効にしても並びが変わらない —— これが症状そのもの', async () => {
    const before = await modelOrder()
    // トグル1回ぶん。UPDATE が行を動かしても表示順は動いてはいけない。
    await applyUiConfig(seed(['gpt-4o']))
    expect(await modelOrder()).toEqual(before)
  })

  test('複数回トグルしても並びが変わらない', async () => {
    const before = await modelOrder()
    await applyUiConfig(seed(['gpt-4o']))
    await applyUiConfig(seed(['gpt-4o', 'o3']))
    await applyUiConfig(seed([]))
    expect(await modelOrder()).toEqual(before)
  })

  test('宣言した全モデルが揃っている', async () => {
    // 並びの担保が、取りこぼしの見落としにならないように。
    expect((await modelOrder()).slice().sort()).toEqual(MODELS.slice().sort())
  })
})
