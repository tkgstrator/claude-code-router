/**
 * Boot-time JSON-to-DB migration. The behaviours we care about:
 *   - idempotent on subsequent runs (nothing-to-migrate),
 *   - refuses to migrate when both DB and disk are populated,
 *   - strips Providers/Router from config.json after success,
 *   - preserves longContextThreshold into RouterSlot.params.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE } from '../../src/shared/constants'
import { runJsonToDbMigration } from '../../src/db/migrateFromJson'
import { composeUiConfig } from '../../src/services/configService'
import { HAS_DB, resetDbTables, teardownPrisma } from './helpers'

// Each test writes a fresh config.json into ~/.claude-code-router/.
async function writeConfig(content: object): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(content, null, 2))
}

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8'))
}

async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(CONFIG_FILE)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

describe.skipIf(!HAS_DB)('runJsonToDbMigration', () => {
  beforeEach(async () => {
    await resetDbTables()
    await deleteConfig()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('no config file -> no-op', async () => {
    const outcome = await runJsonToDbMigration()
    expect(outcome.kind).toBe('no-config-file')
  })

  test('config without legacy keys -> nothing-to-migrate', async () => {
    await writeConfig({ PORT: 3456, transformers: [] })
    const outcome = await runJsonToDbMigration()
    expect(outcome.kind).toBe('nothing-to-migrate')
  })

  test('seeds providers + router and strips them from disk', async () => {
    await writeConfig({
      PORT: 3456,
      transformers: [],
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          models: ['gpt-5', 'gpt-5-nano']
        }
      ],
      Router: {
        default: 'openai,gpt-5',
        longContext: 'openai,gpt-5',
        longContextThreshold: 80_000
      }
    })

    const outcome = await runJsonToDbMigration()
    expect(outcome.kind).toBe('migrated')

    // Disk now only carries the envelope.
    const onDisk = await readConfig()
    expect(onDisk.Providers).toBeUndefined()
    expect(onDisk.Router).toBeUndefined()
    expect(onDisk.PORT).toBe(3456)

    // DB carries the new state.
    const ui = await composeUiConfig()
    expect(ui.Providers).toHaveLength(1)
    expect(ui.Router.default).toBe('openai,gpt-5')
    expect(ui.Router.longContextThreshold).toBe(80_000)
  })

  test('running twice is a no-op the second time', async () => {
    await writeConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5' }
    })

    expect((await runJsonToDbMigration()).kind).toBe('migrated')
    expect((await runJsonToDbMigration()).kind).toBe('nothing-to-migrate')
  })

  test('bails when both DB and disk are populated', async () => {
    // First migration brings DB up.
    await writeConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5' }
    })
    expect((await runJsonToDbMigration()).kind).toBe('migrated')

    // Now the user "restores" their config.json from backup. DB still
    // has rows. Re-running should refuse.
    await writeConfig({
      Providers: [
        {
          name: 'gemini',
          api_base_url: 'https://generativelanguage.googleapis.com',
          api_key: 'AI-x',
          models: ['gemini-2.5-flash']
        }
      ],
      Router: { default: 'gemini,gemini-2.5-flash' }
    })
    const outcome = await runJsonToDbMigration()
    expect(outcome.kind).toBe('bail-both-populated')

    // Both stores untouched after the bail.
    const onDisk = await readConfig()
    expect(Array.isArray(onDisk.Providers)).toBe(true)
    const ui = await composeUiConfig()
    expect(ui.Providers[0].name).toBe('openai')
  })
})
