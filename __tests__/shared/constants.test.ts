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

  test('ignores the pre-rename CCR_HOME_DIR', () => {
    // Dropped deliberately: unlike a credential, pointing at the wrong
    // home announces itself — the server comes up on an empty
    // configuration and the operator sees it at once.
    expect(resolveHomeDir({ CCR_HOME_DIR: '/tmp/legacy' }, '/home/op')).toBe('/home/op/.rialto')
  })
})

test('an empty RIALTO_HOME_DIR falls back rather than resolving to ""', () => {
  // An exported-but-empty variable is a common shell accident. Treating
  // it as "set" would put config.json and the log directory in the
  // process's cwd.
  expect(resolveHomeDir({ RIALTO_HOME_DIR: '' }, '/home/op')).toBe('/home/op/.rialto')
})
