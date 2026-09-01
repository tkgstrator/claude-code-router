/**
 * E2E for the Providers screen.
 *
 * What this guards is the kind of gap left by an empty state nobody
 * designed. The approved mock (`mocks/providers.html`) only draws the
 * screen with seven providers, and there two "Add provider" buttons are
 * correct — the header's primary and the outline one at the foot of the
 * rail serve different purposes. But **with none configured** the rail
 * has no list to append to and the same button stayed, stacking three
 * routes to the same place: header, rail, and the empty-state message.
 *
 * A mock diff cannot catch it, because the mock has no such state. So the
 * rule itself is pinned here.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Browser, Page } from 'playwright'
import { E2E_BASE_URL, HAS_E2E, launchBrowser } from './helpers'

const held: { browser: Browser | null } = { browser: null }

const browser = (): Browser => {
  if (held.browser === null) throw new Error('browser not started')
  return held.browser
}

/** The first-run gate opens once /setup has rendered. From a bare
 *  context, going to /providers bounces to /setup, so pass through it
 *  first. */
async function openProviders(): Promise<Page> {
  const context = await browser().newContext()
  const page = await context.newPage()
  await page.goto(`${E2E_BASE_URL}/setup`, { waitUntil: 'networkidle' })
  await page.goto(`${E2E_BASE_URL}/providers`, { waitUntil: 'networkidle' })
  return page
}

/**
 * Count the provider rows in the rail.
 *
 * This first read the count out of the "N providers · …" heading, but
 * that subtitle only renders **when nothing is selected**: with even one
 * provider the screen auto-selects the first and switches to a per-
 * provider subtitle ("Google AI · API key · …"). The test broke the
 * moment a seed provider appeared — it tripped on the very asymmetry
 * between the empty and non-empty states that it exists to check.
 * Counting the rows holds in both.
 */
async function providerCount(page: Page): Promise<number> {
  return page.locator('aside a[href^="/providers/"]').count()
}

describe.skipIf(!HAS_E2E)('Providers screen', () => {
  beforeAll(async () => {
    held.browser = await launchBrowser()
  })

  afterAll(async () => {
    if (held.browser !== null) await held.browser.close()
  })

  test('"Add provider" is in the header, and in the rail only when there is a list', async () => {
    const page = await openProviders()
    const count = await providerCount(page)
    const buttons = await page.getByText('Add provider', { exact: true }).count()

    // With none, the header's is the only one. With at least one, the
    // route at the foot of the rail has something to append to.
    expect(buttons).toBe(count === 0 ? 1 : 2)
    await page.context().close()
  })

  test('the empty-state message points at a button that exists', async () => {
    // Guards against saying "Use Add provider to connect one" while no
    // "Add provider" is on the screen.
    const page = await openProviders()
    const count = await providerCount(page)
    if (count === 0) {
      // bun:test's expect has none of playwright's matchers
      // (toBeVisible), so resolve the boolean on the locator first.
      expect(await page.getByText('No providers configured yet', { exact: false }).isVisible()).toBe(true)
      expect(await page.getByText('Add provider', { exact: true }).count()).toBeGreaterThan(0)
    }
    await page.context().close()
  })

  test('renders with no console errors', async () => {
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
