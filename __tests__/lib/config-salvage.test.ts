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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// CONFIG_FILE is derived from CCR_HOME_DIR when shared/constants.ts is
// first imported, so the home has to be set before the import below and
// stays fixed for the whole file.
const HOME = mkdtempSync(join(tmpdir(), 'ccr-salvage-'))
process.env.CCR_HOME_DIR = HOME

const { readConfigFile } = await import('../../src/services/config/envelope')

const CONFIG = join(HOME, 'config.json')
const KEY = 'a'.repeat(64)
const asides = (): string[] => readdirSync(HOME).filter((n) => n.includes('.invalid-'))

beforeEach(() => {
  for (const name of readdirSync(HOME)) rmSync(join(HOME, name), { recursive: true, force: true })
})

describe('readConfigFile — unusable config', () => {
  test('keeps the bootstrap token when the file fails schema validation', async () => {
    // PORT must be a positive int; a non-numeric string fails the schema.
    writeFileSync(CONFIG, JSON.stringify({ APIKEY: KEY, PORT: 'not-a-port' }))
    const envelope = await readConfigFile()
    expect(envelope.APIKEY).toBe(KEY)
  })

  test('keeps the persona library, which is stored nowhere else', async () => {
    const personas = [{ id: 'p1', name: 'Mine', prompt: 'hello' }]
    writeFileSync(CONFIG, JSON.stringify({ APIKEY: KEY, PORT: 'bad', Personas: personas }))
    const envelope = await readConfigFile()
    expect(envelope.Personas).toEqual(personas)
  })

  test('moves the unusable file aside instead of deleting it', async () => {
    writeFileSync(CONFIG, JSON.stringify({ APIKEY: KEY, PORT: 'bad' }))
    await readConfigFile()
    const moved = asides()
    expect(moved).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(HOME, moved[0]), 'utf-8')).APIKEY).toBe(KEY)
  })

  test('still writes a usable config so the server can boot', async () => {
    writeFileSync(CONFIG, JSON.stringify({ APIKEY: KEY, PORT: 'bad' }))
    const envelope = await readConfigFile()
    expect(existsSync(CONFIG)).toBe(true)
    expect(envelope.PORT).toBe(3456)
  })

  test('mints a token only when the broken file carried none', async () => {
    writeFileSync(CONFIG, JSON.stringify({ PORT: 'bad' }))
    const envelope = await readConfigFile()
    expect(typeof envelope.APIKEY).toBe('string')
    expect(envelope.APIKEY.length).toBeGreaterThan(0)
  })

  test('preserves a file JSON5 cannot read, even though nothing is salvageable from it', async () => {
    writeFileSync(CONFIG, '{ this is not json at all ')
    await readConfigFile()
    expect(asides()).toHaveLength(1)
  })
})
