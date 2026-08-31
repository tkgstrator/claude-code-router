/**
 * The home-directory environment variable.
 *
 * HOME_DIR is frozen at module import time, so the resolution rule is
 * exported as a pure function and tested here instead. What matters is
 * the backward-compatible half: an operator who set CCR_HOME_DIR before
 * the rename must keep reading the same directory afterwards.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { resolveHomeDir } from '../../src/shared/constants'

describe('resolveHomeDir', () => {
  test('defaults to ~/.rialto', () => {
    expect(resolveHomeDir({}, '/home/op')).toBe(join('/home/op', '.rialto'))
  })

  test('honours RIALTO_HOME_DIR', () => {
    expect(resolveHomeDir({ RIALTO_HOME_DIR: '/tmp/pinned' }, '/home/op')).toBe('/tmp/pinned')
  })

  test('still honours the pre-rename CCR_HOME_DIR', () => {
    // An operator who set this before the rename must not silently be
    // moved to ~/.rialto and find an empty configuration.
    expect(resolveHomeDir({ CCR_HOME_DIR: '/tmp/legacy' }, '/home/op')).toBe('/tmp/legacy')
  })

  test('prefers the new name when both are set', () => {
    expect(resolveHomeDir({ RIALTO_HOME_DIR: '/tmp/new', CCR_HOME_DIR: '/tmp/legacy' }, '/home/op')).toBe('/tmp/new')
  })
})
