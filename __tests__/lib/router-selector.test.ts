/**
 * Which selector the Routing screens claim is live.
 *
 * `ROUTER_MODE` carries three values and the request path branches on
 * one: `scenario-router.ts` swaps in the preference chain's answer only
 * under `quota-aware`, so `preference` routes exactly like `scenario`.
 * The screen used to show a Rules editor and a Chain editor side by side
 * with nothing saying which of them ran; these pin the mapping the switch
 * displays and writes back, in both directions, so a third mode can never
 * quietly render as a fourth state.
 */

import { describe, expect, test } from 'bun:test'
import { activeSelector, MODE_FOR_SELECTOR } from '../../src/components/rialto/routing/derive'

describe('activeSelector', () => {
  test('quota-aware is the only mode the chain decides under', () => {
    expect(activeSelector('quota-aware')).toBe('chain')
  })

  test('scenario runs the rule stack', () => {
    expect(activeSelector('scenario')).toBe('rules')
  })

  test('preference has no runtime branch, so it reads as rules rather than a third label', () => {
    expect(activeSelector('preference')).toBe('rules')
  })

  test('an absent mode is the seeded default, not unknown', () => {
    // The envelope ships without the key; `readRouterMode` defaults it to
    // 'scenario', and the switch has to agree or it shows the wrong side
    // selected on every fresh install.
    expect(activeSelector(undefined)).toBe('rules')
  })
})

describe('MODE_FOR_SELECTOR', () => {
  test('round-trips both selectors through the mode the switch writes', () => {
    expect(activeSelector(MODE_FOR_SELECTOR.rules)).toBe('rules')
    expect(activeSelector(MODE_FOR_SELECTOR.chain)).toBe('chain')
  })
})
