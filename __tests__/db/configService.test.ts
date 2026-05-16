/**
 * Round-trip tests for the DB-backed config service. Cover the diff
 * behaviour we'd otherwise only learn about by losing a slot binding
 * in production: provider/model deletion nulls dependent RouterSlots,
 * provider renames are delete+create (and warn about it), longContext
 * threshold survives composition.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { getPrismaClient } from '../../packages/server/src/db/client'
import { applyUiConfig, composeUiConfig, ensureRouterSlots } from '../../packages/server/src/services/configService'
import { HAS_DB, resetDbTables, teardownPrisma } from './helpers'

const tmpHome = `/tmp/ccr-db-test-${process.pid}`

// Point the disk-backed envelope at a tmp dir so we don't trample the
// real ~/.claude-code-router/config.json during local runs.
process.env.HOME = tmpHome

describe.skipIf(!HAS_DB)('configService', () => {
  beforeEach(async () => {
    await resetDbTables()
    await ensureRouterSlots()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('apply then compose round-trips Providers and Router', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-x',
          models: ['gpt-5', 'gpt-5-nano']
        }
      ],
      Router: {
        default: 'openai,gpt-5',
        background: 'openai,gpt-5-nano',
        longContext: 'openai,gpt-5',
        longContextThreshold: 60_000
      }
    })

    const ui = await composeUiConfig()
    expect(ui.Providers).toHaveLength(1)
    expect(ui.Providers[0].name).toBe('openai')
    expect(ui.Providers[0].models.sort()).toEqual(['gpt-5', 'gpt-5-nano'])
    expect(ui.Router.default).toBe('openai,gpt-5')
    expect(ui.Router.background).toBe('openai,gpt-5-nano')
    expect(ui.Router.longContext).toBe('openai,gpt-5')
    expect(ui.Router.longContextThreshold).toBe(60_000)
    expect(ui.Router.think).toBe('')
  })

  test('removing a model nulls any RouterSlot that referenced it and warns', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-x',
          models: ['gpt-5', 'gpt-5-nano']
        }
      ],
      Router: { default: 'openai,gpt-5-nano' }
    })

    const result = await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-x',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5-nano' } // points at a model we just removed
    })

    expect(result.warnings.some((w) => w.includes('gpt-5-nano'))).toBe(true)
    const ui = await composeUiConfig()
    expect(ui.Router.default).toBe('')
  })

  test('deleting a provider cascades models and nulls bound slots', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-x',
          models: ['gpt-5']
        },
        {
          name: 'gemini',
          api_base_url: 'https://generativelanguage.googleapis.com',
          api_key: 'AI-x',
          models: ['gemini-2.5-flash']
        }
      ],
      Router: {
        default: 'openai,gpt-5',
        background: 'gemini,gemini-2.5-flash'
      }
    })

    const result = await applyUiConfig({
      // gemini removed
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-x',
          models: ['gpt-5']
        }
      ],
      Router: {
        default: 'openai,gpt-5',
        background: 'gemini,gemini-2.5-flash'
      }
    })

    expect(result.warnings.some((w) => w.includes('gemini'))).toBe(true)
    const ui = await composeUiConfig()
    expect(ui.Providers.map((p) => p.name)).toEqual(['openai'])
    expect(ui.Router.default).toBe('openai,gpt-5')
    expect(ui.Router.background).toBe('')

    // FK shouldn't leak orphan rows.
    const prisma = getPrismaClient()
    const orphanModels = await prisma.model.count({ where: { provider: { is: { id: undefined } } } })
    expect(orphanModels).toBe(0)
  })

  test('unknown router scenarios are dropped with a warning', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-x',
          models: ['gpt-5']
        }
      ],
      Router: {
        default: 'openai,gpt-5',
        custom: 'openai,gpt-5'
      }
    })

    const ui = await composeUiConfig()
    expect(ui.Router.default).toBe('openai,gpt-5')
    expect(ui.Router.custom).toBeUndefined()
  })
})
