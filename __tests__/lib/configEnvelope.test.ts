/**
 * readConfigFile — JSON5 parsing and environment variable interpolation.
 * applyEnvelopeToEnv — scalar mirroring onto process.env.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE } from '../../src/shared/constants'
import { applyEnvelopeToEnv, readConfigFile } from '../../src/lib/configEnvelope'

async function writeConfig(content: string): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
  await fs.writeFile(CONFIG_FILE, content)
}

async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(CONFIG_FILE)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

describe('readConfigFile', () => {
  beforeEach(deleteConfig)
  afterEach(deleteConfig)

  test('parses standard JSON', async () => {
    await writeConfig(JSON.stringify({ PORT: 3456, LOG: false, LOG_LEVEL: 'info', APIKEY: 'test-key' }))
    const cfg = await readConfigFile()
    expect(cfg.PORT).toBe(3456)
    expect(cfg.LOG).toBe(false)
  })

  test('parses JSON5 with comments and trailing commas', async () => {
    await writeConfig(`{
      // server port
      PORT: 3456,
      LOG: true, // trailing comma
      LOG_LEVEL: 'info',
      APIKEY: 'test-key',
    }`)
    const cfg = await readConfigFile()
    expect(cfg.PORT).toBe(3456)
    expect(cfg.LOG).toBe(true)
  })

  test('interpolates $VAR_NAME', async () => {
    process.env.TEST_CCR_KEY = 'sk-real'
    await writeConfig(JSON.stringify({ LOG: false, LOG_LEVEL: 'info', APIKEY: '$TEST_CCR_KEY' }))
    const cfg = await readConfigFile()
    expect(cfg.APIKEY).toBe('sk-real')
    delete process.env.TEST_CCR_KEY
  })

  test('interpolates ${VAR_NAME}', async () => {
    process.env.TEST_CCR_HOST = '0.0.0.0'
    await writeConfig(JSON.stringify({ HOST: '${TEST_CCR_HOST}', LOG: false, LOG_LEVEL: 'info', APIKEY: 'test-key' }))
    const cfg = await readConfigFile()
    expect(cfg.HOST).toBe('0.0.0.0')
    delete process.env.TEST_CCR_HOST
  })

  test('keeps literal when env var is unset', async () => {
    delete process.env.UNSET_CCR_VAR
    await writeConfig(JSON.stringify({ LOG: false, LOG_LEVEL: 'info', APIKEY: '$UNSET_CCR_VAR' }))
    const cfg = await readConfigFile()
    expect(cfg.APIKEY).toBe('$UNSET_CCR_VAR')
  })

  test('interpolates env vars inside nested objects and arrays', async () => {
    process.env.TEST_CCR_BASE = 'https://api.example.com'
    await writeConfig(
      JSON.stringify({
        LOG: false,
        LOG_LEVEL: 'info',
        APIKEY: 'test-key',
        Providers: [{ name: 'test', api_base_url: '$TEST_CCR_BASE' }]
      })
    )
    const cfg = await readConfigFile() as Record<string, unknown>
    const providers = cfg.Providers as { api_base_url: string }[]
    expect(providers[0].api_base_url).toBe('https://api.example.com')
    delete process.env.TEST_CCR_BASE
  })

  test('returns default config when file does not exist', async () => {
    const cfg = await readConfigFile()
    expect(cfg).toMatchObject({ PORT: expect.any(Number), Providers: [] })
  })
})

describe('readConfigFile — API_TIMEOUT_MS handling', () => {
  beforeEach(deleteConfig)
  afterEach(deleteConfig)

  test('string API_TIMEOUT_MS passes schema validation (config is not deleted)', async () => {
    // Pre-fix configs written by the old UI stored API_TIMEOUT_MS as a string.
    // z.coerce.number() ensures those files survive startup rather than being
    // wiped and recreated as a default config (which loses all other settings).
    await writeConfig(
      JSON.stringify({ PORT: 3456, LOG: false, LOG_LEVEL: 'info', APIKEY: 'key', API_TIMEOUT_MS: '30000' })
    )
    const cfg = await readConfigFile()
    // readConfigFile returns the raw parsed JSON (pre-coercion), so the value
    // is still a string. The important guarantee is that it does NOT fall back
    // to createDefaultConfig() — APIKEY is preserved.
    expect((cfg as Record<string, unknown>).APIKEY).toBe('key')
    expect((cfg as Record<string, unknown>).PORT).toBe(3456)
  })

  test('number API_TIMEOUT_MS is accepted and returned as-is', async () => {
    await writeConfig(
      JSON.stringify({ PORT: 3456, LOG: false, LOG_LEVEL: 'info', APIKEY: 'key', API_TIMEOUT_MS: 30000 })
    )
    const cfg = await readConfigFile()
    expect((cfg as Record<string, unknown>).API_TIMEOUT_MS).toBe(30000)
  })

  test('absent API_TIMEOUT_MS is valid (field is optional)', async () => {
    await writeConfig(JSON.stringify({ PORT: 3456, LOG: false, LOG_LEVEL: 'info', APIKEY: 'key' }))
    const cfg = await readConfigFile()
    expect((cfg as Record<string, unknown>).API_TIMEOUT_MS).toBeUndefined()
    // Config was NOT recreated — original settings are preserved.
    expect((cfg as Record<string, unknown>).APIKEY).toBe('key')
  })

  test('negative API_TIMEOUT_MS fails validation and triggers default config creation', async () => {
    await writeConfig(
      JSON.stringify({ PORT: 3456, LOG: false, LOG_LEVEL: 'info', APIKEY: 'key', API_TIMEOUT_MS: -1 })
    )
    const cfg = await readConfigFile()
    // A default config is created; the original APIKEY is lost, but a new one is generated.
    expect((cfg as Record<string, unknown>).API_TIMEOUT_MS).toBeUndefined()
    expect(typeof (cfg as Record<string, unknown>).APIKEY).toBe('string')
    expect((cfg as Record<string, unknown>).APIKEY).not.toBe('key')
  })

  test('non-numeric string API_TIMEOUT_MS fails validation and triggers default config creation', async () => {
    await writeConfig(
      JSON.stringify({ PORT: 3456, LOG: false, LOG_LEVEL: 'info', APIKEY: 'key', API_TIMEOUT_MS: 'fast' })
    )
    const cfg = await readConfigFile()
    expect((cfg as Record<string, unknown>).APIKEY).not.toBe('key')
  })

  test('"600000" (old UI default value as string) does not destroy config', async () => {
    const originalApikey = 'my-production-apikey'
    await writeConfig(
      JSON.stringify({
        PORT: 3456,
        LOG: true,
        LOG_LEVEL: 'debug',
        APIKEY: originalApikey,
        API_TIMEOUT_MS: '600000'
      })
    )
    const cfg = await readConfigFile()
    expect((cfg as Record<string, unknown>).APIKEY).toBe(originalApikey)
    expect((cfg as Record<string, unknown>).LOG).toBe(true)
    expect((cfg as Record<string, unknown>).LOG_LEVEL).toBe('debug')
  })
})

describe('applyEnvelopeToEnv', () => {
  test('mirrors string scalar keys onto process.env', () => {
    applyEnvelopeToEnv({ HOST: '127.0.0.1', APIKEY: 'key123' })
    expect(process.env.HOST).toBe('127.0.0.1')
    expect(process.env.APIKEY).toBe('key123')
  })

  test('coerces number and boolean to string', () => {
    applyEnvelopeToEnv({ PORT: 3456, LOG: true })
    expect(process.env.PORT).toBe('3456')
    expect(process.env.LOG).toBe('true')
  })

  test('skips null and undefined values', () => {
    delete process.env.PROXY_URL
    applyEnvelopeToEnv({ PROXY_URL: null })
    expect(process.env.PROXY_URL).toBeUndefined()
  })

  test('skips object and array values', () => {
    const before = process.env.StatusLine
    applyEnvelopeToEnv({ StatusLine: { enabled: true } } as Record<string, unknown>)
    expect(process.env.StatusLine).toBe(before)
  })
})
