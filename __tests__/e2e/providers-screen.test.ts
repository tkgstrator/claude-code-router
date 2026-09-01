/**
 * Providers 画面の E2E。
 *
 * 守っているのは「空状態が設計されていない」という種類のズレである。
 * 承認済みモック（`mocks/providers.html`）は provider が 7 件ある状態しか
 * 描いておらず、そこでは "Add provider" が2つあるのが正しい —— ヘッダーの
 * primary と、一覧レールの末尾に付く outline で、役割が違うからである。
 * ところが**0件のとき**はレールに追加すべき一覧が無いのに同じボタンが残り、
 * ヘッダー・レール・空状態メッセージで同じ導線が3つ縦に並んでいた。
 *
 * モックとの差分では捕まらない（モックにその状態が無い）ので、
 * ここで規則そのものを固定する。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Browser, Page } from 'playwright'
import { E2E_BASE_URL, HAS_E2E, launchBrowser } from './helpers'

const held: { browser: Browser | null } = { browser: null }

const browser = (): Browser => {
  if (held.browser === null) throw new Error('browser not started')
  return held.browser
}

/** 初回起動ゲートは /setup を1度描くと開く。素の context だと
 *  /providers へ行っても /setup に飛ばされるので、先に通しておく。 */
async function openProviders(): Promise<Page> {
  const context = await browser().newContext()
  const page = await context.newPage()
  await page.goto(`${E2E_BASE_URL}/setup`, { waitUntil: 'networkidle' })
  await page.goto(`${E2E_BASE_URL}/providers`, { waitUntil: 'networkidle' })
  return page
}

/**
 * レールに並んでいる provider 行を数える。
 *
 * 最初は見出しの "N providers · …" から読んでいたが、あれは**何も選択
 * されていないときだけ**出る要約で、provider が1件でもあると画面は先頭を
 * 自動選択して個別の副題（"Google AI · API key · …"）に切り替わる。
 * シード provider が入った瞬間にテストが壊れた —— まさにこのテストが
 * 見ようとしている「空状態と非空状態の非対称」を、テスト自身が踏んだ。
 * 行そのものを数えれば両方の状態で成り立つ。
 */
async function providerCount(page: Page): Promise<number> {
  return page.locator('aside a[href^="/providers/"]').count()
}

describe.skipIf(!HAS_E2E)('Providers 画面', () => {
  beforeAll(async () => {
    held.browser = await launchBrowser()
  })

  afterAll(async () => {
    if (held.browser !== null) await held.browser.close()
  })

  test('"Add provider" はヘッダーに1つ、一覧があるときだけレールにもう1つ', async () => {
    const page = await openProviders()
    const count = await providerCount(page)
    const buttons = await page.getByText('Add provider', { exact: true }).count()

    // 0 件ならヘッダーのみ。1 件以上ならレール末尾の追加導線が意味を持つ。
    expect(buttons).toBe(count === 0 ? 1 : 2)
    await page.context().close()
  })

  test('空状態のメッセージは実在するボタンを指している', async () => {
    // 「Use Add provider to connect one」と書いておいて、その "Add provider"
    // が画面に無い、という状態を作らないための担保。
    const page = await openProviders()
    const count = await providerCount(page)
    if (count === 0) {
      // bun:test の expect には playwright のマッチャ（toBeVisible）が
      // 無いので、locator 側で真偽を取ってから assert する。
      expect(await page.getByText('No providers configured yet', { exact: false }).isVisible()).toBe(true)
      expect(await page.getByText('Add provider', { exact: true }).count()).toBeGreaterThan(0)
    }
    await page.context().close()
  })

  test('コンソールエラーなしで描画される', async () => {
    const context = await browser().newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto(`${E2E_BASE_URL}/setup`, { waitUntil: 'networkidle' })
    await page.goto(`${E2E_BASE_URL}/providers`, { waitUntil: 'networkidle' })
    expect(errors).toEqual([])
    await context.close()
  })
})
