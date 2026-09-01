/**
 * A config file that fails to load must not be destroyed.
 *
 * Regression coverage for a real incident: `readConfigFile` responded to
 * a schema-validation failure by unlinking the operator's config and
 * generating a fresh one — which rotated APIKEY and locked out every
 * configured client. There are no backups, so the file was the only
 * copy, and a single bad key (including one arriving from a stray
 * environment variable) was enough to trigger it.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readConfigFile } from '../../src/services/config/envelope'
import { CONFIG_FILE } from '../../src/shared/constants'

// Operate on whatever home the module actually resolved. CONFIG_FILE is
// computed once, when shared/constants.ts is first imported, so in a
// full-suite run the winning value belongs to whichever test file
// imported it first — the preload's tmp home. Deriving the directory
// from CONFIG_FILE keeps this file correct either way instead of
// depending on import order.
const HOME = dirname(CONFIG_FILE)
const KEY = 'a'.repeat(64)
const asides = (): string[] => readdirSync(HOME).filter((n) => n.includes('.invalid-'))

beforeEach(() => {
  mkdirSync(HOME, { recursive: true })
  for (const name of readdirSync(HOME)) rmSync(join(HOME, name), { recursive: true, force: true })
})

describe('readConfigFile — unusable config', () => {
  test('keeps the bootstrap token when the file fails schema validation', async () => {
    // PORT must be a positive int; a non-numeric string fails the schema.
    writeFileSync(CONFIG_FILE, JSON.stringify({ APIKEY: KEY, PORT: 'not-a-port' }))
    const envelope = await readConfigFile()
    expect(envelope.APIKEY).toBe(KEY)
  })

  test('keeps the persona library, which is stored nowhere else', async () => {
    const personas = [{ id: 'p1', name: 'Mine', prompt: 'hello' }]
    writeFileSync(CONFIG_FILE, JSON.stringify({ APIKEY: KEY, PORT: 'bad', Personas: personas }))
    const envelope = await readConfigFile()
    expect(envelope.Personas).toEqual(personas)
  })

  test('moves the unusable file aside instead of deleting it', async () => {
    writeFileSync(CONFIG_FILE, JSON.stringify({ APIKEY: KEY, PORT: 'bad' }))
    await readConfigFile()
    const moved = asides()
    expect(moved).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(HOME, moved[0]), 'utf-8')).APIKEY).toBe(KEY)
  })

  test('still writes a usable config so the server can boot', async () => {
    writeFileSync(CONFIG_FILE, JSON.stringify({ APIKEY: KEY, PORT: 'bad' }))
    const envelope = await readConfigFile()
    expect(existsSync(CONFIG_FILE)).toBe(true)
    expect(envelope.PORT).toBe(3456)
  })

  test('does not invent a token the broken file never had', async () => {
    // Minting one here would hand a master key for /api/* to an install
    // that had deliberately gone without.
    writeFileSync(CONFIG_FILE, JSON.stringify({ PORT: 'bad' }))
    const envelope = await readConfigFile()
    expect(envelope.APIKEY).toBe('')
  })

  test('preserves a file JSON5 cannot read, even though nothing is salvageable from it', async () => {
    writeFileSync(CONFIG_FILE, '{ this is not json at all ')
    await readConfigFile()
    expect(asides()).toHaveLength(1)
  })
})
