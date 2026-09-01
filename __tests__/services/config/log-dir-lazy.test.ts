/**
 * The logger must not create the home directory when it is imported.
 *
 * migrateHomeDir() is idempotent by "the destination already exists", so
 * anything that materialises ~/.rialto before src/index.ts runs the
 * migration turns the copy into a permanent no-op — the operator boots on
 * an empty configuration and the old one sits next to it, apparently
 * redundant. The logger used to mkdir its LOG_DIR at import time, which
 * happens before any top-level statement in the entrypoint.
 *
 * Import order cannot be observed from inside this process (the preload
 * has already pinned RIALTO_HOME_DIR and the logger is long since
 * imported), so this runs a child that imports nothing but the logger.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('logger import', () => {
  test('does not create the log directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'rialto-lazy-log-'))
    roots.push(root)
    const home = join(root, '.rialto')

    const child = Bun.spawnSync({
      cmd: ['bun', '-e', "import('./src/logger').then(() => {})"],
      cwd: process.cwd(),
      env: { ...process.env, RIALTO_HOME_DIR: home, LOG: 'false' },
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(child.exitCode).toBe(0)
    expect(existsSync(home)).toBe(false)
  })

  test('still creates it on the first line written to disk', () => {
    // The negative control for the test above: proves the child really
    // does exercise the file sink, so "the directory is absent" means
    // "creation moved", not "the logger never ran".
    const root = mkdtempSync(join(tmpdir(), 'rialto-lazy-log-'))
    roots.push(root)
    const home = join(root, '.rialto')

    const child = Bun.spawnSync({
      cmd: ['bun', '-e', "import('./src/logger').then((m) => m.logger.error('written'))"],
      cwd: process.cwd(),
      env: { ...process.env, RIALTO_HOME_DIR: home, LOG: 'true', LOG_LEVEL: 'error' },
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(child.exitCode).toBe(0)
    expect(existsSync(join(home, 'logs'))).toBe(true)
  })
})
