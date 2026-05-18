/**
 * readConfigFile — JSON5 parsing and environment variable interpolation.
 * applyEnvelopeToEnv — scalar mirroring onto process.env.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE } from '../../packages/shared/src/constants'
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
    await writeConfig(JSON.stringify({ PORT: 3456, LOG: false }))
    const cfg = await readConfigFile()
    expect(cfg.PORT).toBe(3456)
    expect(cfg.LOG).toBe(false)
  })

  test('parses JSON5 with comments and trailing commas', async () => {
    await writeConfig(`{
      // server port
      PORT: 3456,
      LOG: true, // trailing comma
    }`)
    const cfg = await readConfigFile()
    expect(cfg.PORT).toBe(3456)
    expect(cfg.LOG).toBe(true)
  })

  test('interpolates $VAR_NAME', async () => {
    process.env.TEST_CCR_KEY = 'sk-real'
    await writeConfig(JSON.stringify({ APIKEY: '$TEST_CCR_KEY' }))
    const cfg = await readConfigFile()
    expect(cfg.APIKEY).toBe('sk-real')
    delete process.env.TEST_CCR_KEY
  })

  test('interpolates ${VAR_NAME}', async () => {
    process.env.TEST_CCR_HOST = '0.0.0.0'
    await writeConfig(JSON.stringify({ HOST: '${TEST_CCR_HOST}' }))
    const cfg = await readConfigFile()
    expect(cfg.HOST).toBe('0.0.0.0')
    delete process.env.TEST_CCR_HOST
  })

  test('keeps literal when env var is unset', async () => {
    delete process.env.UNSET_CCR_VAR
    await writeConfig(JSON.stringify({ APIKEY: '$UNSET_CCR_VAR' }))
    const cfg = await readConfigFile()
    expect(cfg.APIKEY).toBe('$UNSET_CCR_VAR')
  })

  test('interpolates env vars inside nested objects and arrays', async () => {
    process.env.TEST_CCR_BASE = 'https://api.example.com'
    await writeConfig(
      JSON.stringify({
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
