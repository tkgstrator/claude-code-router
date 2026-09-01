/**
 * 初回起動ゲートの E2E。
 *
 * ここで押さえているのは、ユニットテストでは原理的に捕まえられなかった
 * 種類のバグである。`markSetupOffered()` は実装され、テストもでき、
 * `ProtectedRoute` から読む側も実装されていた。**誰も呼んでいなかった**
 * だけで、その1点は「関数が正しいか」を見るテストのどこにも現れない。
 * 症状は「Skip setup を押しても何も起きない」——押下も遷移も起きていて、
 * ゲートが即座に引き戻していた。
 *
 * したがってここでの主張は「関数が動く」ではなく、**画面がその関数を
 * 実際に呼んでいる**ことと、**押した結果ユーザーが目的地に留まる**こと
 * の2つに絞ってある。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Browser, Page } from 'playwright'
import { E2E_BASE_URL, HAS_E2E, launchBrowser } from './helpers'

const SETUP_OFFERED_KEY = 'rialto.setup-offered'

const held: { browser: Browser | null } = { browser: null }

const browser = (): Browser => {
  if (held.browser === null) throw new Error('browser not started')
  return held.browser
}

/** 毎回まっさらなコンテキストで開く。sessionStorage を持ち越すと、前の
 *  テストが立てた「提示済み」で次のテストのゲートが開いてしまう。 */
async function open(path: string): Promise<Page> {
  const context = await browser().newContext()
  const page = await context.newPage()
  await page.goto(`${E2E_BASE_URL}${path}`, { waitUntil: 'networkidle' })
  return page
}

describe.skipIf(!HAS_E2E)('初回起動ゲート', () => {
  beforeAll(async () => {
    held.browser = await launchBrowser()
  })

  afterAll(async () => {
    if (held.browser !== null) await held.browser.close()
  })

  test('/setup を描画した時点で「提示済み」が記録される', async () => {
    // これが配線バグそのものの回帰テスト。実装されているのに呼ばれて
    // いない、という状態はここでしか現れない。
    const page = await open('/setup')
    const marked = await page.evaluate((key) => sessionStorage.getItem(key), SETUP_OFFERED_KEY)
    expect(marked).not.toBeNull()
    await page.context().close()
  })

  test('Skip setup を押すと /overview に着き、引き戻されない', async () => {
    const page = await open('/setup')
    await page.getByText('Skip setup', { exact: true }).click()
    await page.waitForURL(/\/overview$/, { timeout: 5000 })

    // 引き戻しは遷移の直後に起きるので、着地して終わりではなく
    // 「留まっている」ことまで見る。ゲートは再レンダーのたびに評価される。
    await page.waitForTimeout(500)
    expect(new URL(page.url()).pathname).toBe('/overview')
    await page.context().close()
  })

  test('Skip setup が 1 行に収まる', async () => {
    // インライン要素が折り返すと client rect が複数になる。高さを閾値と
    // 比べるより、DOM が直接答えてくれるこちらのほうが壊れにくい。
    const page = await open('/setup')
    const rects = await page
      .getByText('Skip setup', { exact: true })
      .evaluate((el) => el.getClientRects().length)
    expect(rects).toBe(1)
    await page.context().close()
  })

  test('/setup がコンソールエラーなしで描画される', async () => {
    const context = await browser().newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto(`${E2E_BASE_URL}/setup`, { waitUntil: 'networkidle' })
    expect(errors).toEqual([])
    await context.close()
  })
})
