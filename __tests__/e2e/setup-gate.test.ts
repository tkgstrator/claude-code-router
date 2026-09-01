/**
 * E2E for the first-run gate.
 *
 * What this catches is a class of bug a unit test cannot reach.
 * `markSetupOffered()` was implemented, was tested, and the side that
 * reads it from `ProtectedRoute` was implemented too. **Nothing called
 * it** — and that single fact appears nowhere in a test that asks whether
 * the function is correct. The symptom was "Skip setup does nothing":
 * the click and the navigation both happened, and the gate pulled the
 * user straight back.
 *
 * So the claims here are not "the function works" but the two things a
 * unit test could not make: that **the screen actually calls it**, and
 * that **the user stays where the click took them**.
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

/** Open in a fresh context each time. Carrying sessionStorage over would
 *  let the "already offered" mark one test writes open the next one's
 *  gate. */
async function open(path: string): Promise<Page> {
  const context = await browser().newContext()
  const page = await context.newPage()
  await page.goto(`${E2E_BASE_URL}${path}`, { waitUntil: 'networkidle' })
  return page
}

describe.skipIf(!HAS_E2E)('first-run gate', () => {
  beforeAll(async () => {
    held.browser = await launchBrowser()
  })

  afterAll(async () => {
    if (held.browser !== null) await held.browser.close()
  })

  test('rendering /setup records that setup was offered', async () => {
    // The regression test for the wiring bug itself. "Implemented but
    // never called" shows up here and nowhere else.
    const page = await open('/setup')
    const marked = await page.evaluate((key) => sessionStorage.getItem(key), SETUP_OFFERED_KEY)
    expect(marked).not.toBeNull()
    await page.context().close()
  })

  test('Skip setup lands on /overview and is not pulled back', async () => {
    const page = await open('/setup')
    await page.getByText('Skip setup', { exact: true }).click()
    await page.waitForURL(/\/overview$/, { timeout: 5000 })

    // The pull-back happens right after the navigation, so arriving is
    // not enough — this waits to confirm the page stays. The gate is
    // evaluated on every re-render.
    await page.waitForTimeout(500)
    expect(new URL(page.url()).pathname).toBe('/overview')
    await page.context().close()
  })

  test('Skip setup fits on one line', async () => {
    // A wrapped inline element reports more than one client rect. Asking
    // the DOM directly is sturdier than comparing a height to a
    // threshold.
    const page = await open('/setup')
    const rects = await page.getByText('Skip setup', { exact: true }).evaluate((el) => el.getClientRects().length)
    expect(rects).toBe(1)
    await page.context().close()
  })

  test('/setup renders with no console errors', async () => {
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
