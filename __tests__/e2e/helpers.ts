/**
 * E2E テストの共有基盤。
 *
 * 使うのは実際に走っている dev サーバーで、テストがサーバーを起動する
 * ことはない（CLAUDE.md: dev サーバーは常時1台動いている前提で、2台目を
 * 立てると :16175 を奪い合う）。到達できなければ丸ごと skip する ——
 * `HAS_DB` と同じ作法で、CI や dev サーバーを止めている環境で赤くしない。
 *
 * ブラウザは playwright 同梱の chromium。`bunx playwright install chromium`
 * が済んでいない環境では launch が投げるので、そこも skip 条件に含める。
 *
 * **相手が生きている dev サーバーである以上、編集中は落ちうる。** Vite が
 * HMR している最中に叩くと、実装の欠陥ではなく再ビルドの隙間で失敗する。
 * 実際このスイートを入れた日に、別作業の編集中だけ 15 件が落ち、編集が
 * 止まったあとは3回連続で緑だった。**赤を見たらまず「いま誰かが触って
 * いないか」を疑い、手を止めてから測り直すこと。** 落ち続けるなら本物。
 */

import { type Browser, chromium } from 'playwright'

const configured = process.env.RIALTO_E2E_BASE_URL
export const E2E_BASE_URL = configured === undefined || configured.length === 0 ? 'http://localhost:16175' : configured

async function serverUp(): Promise<boolean> {
  if (process.env.RIALTO_SKIP_E2E === '1') return false
  try {
    // 短いタイムアウト。サーバーが居ないときに毎回待たされるのと、
    // 居るのに取りこぼすののトレードオフ。
    const res = await fetch(E2E_BASE_URL, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

async function browserUsable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true })
    await browser.close()
    return true
  } catch {
    return false
  }
}

/**
 * サーバーとブラウザの両方が揃ったときだけ E2E を走らせる。両方を
 * 起動時に1度だけ確かめるのは、`describe.skipIf` が収集時に値を要求する
 * ため。
 */
export const HAS_E2E = (await serverUp()) && (await browserUsable())

export function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true })
}
