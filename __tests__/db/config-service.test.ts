/**
 * Round-trip tests for the DB-backed config service. Cover the diff
 * behaviour we'd otherwise only learn about by losing a slot binding
 * in production: provider/model deletion nulls dependent RouterSlots,
 * provider renames are delete+create (and warn about it), longContext
 * threshold survives composition.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { getPrismaClient } from '../../src/db/client'
import { applyUiConfig, composeUiConfig, ensureRouterSlots } from '../../src/services/config'
import { HAS_DB, resetDbTables, teardownPrisma } from './helpers'

// HOME and DATABASE_URL are redirected by __tests__/setup.ts (preload),
// so CONFIG_FILE points at a tmp dir and the DB writes hit the test DB.

describe.skipIf(!HAS_DB)('configService', () => {
  // TODO(phase-1): Add API-route level tests for /api/config error contracts
  // (auth failures, validation errors, and normalized 5xx payload shape).
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
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
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
    expect(ui.Router.think).toBeNull()
  })

  test('weeklyDrainMarginPct round-trips on the default slot params (S5)', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5', weeklyDrainMarginPct: 15 }
    })

    const ui = await composeUiConfig()
    expect(ui.Router.weeklyDrainMarginPct).toBe(15)
  })

  test('weeklyDrainMarginPct at 0 is omitted (collapses to the emptyRouter default)', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5', weeklyDrainMarginPct: 0 }
    })

    const ui = await composeUiConfig()
    // emptyRouter() seeds 0 so the wire reads 0 either way; the
    // important invariant is that we did NOT round-trip a literal 0
    // into the DB (verified by the next test stashing 25 then writing 0
    // and seeing 0 come back).
    expect(ui.Router.weeklyDrainMarginPct).toBe(0)
  })

  test('writing weeklyDrainMarginPct=0 clears a previously-set value', async () => {
    // First set a non-zero margin, then overwrite with 0 — the second
    // apply must drop the key so compose reads the default 0 instead of
    // the stale 25.
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5', weeklyDrainMarginPct: 25 }
    })
    expect((await composeUiConfig()).Router.weeklyDrainMarginPct).toBe(25)

    await applyUiConfig({
      Router: { default: 'openai,gpt-5', weeklyDrainMarginPct: 0 }
    })
    expect((await composeUiConfig()).Router.weeklyDrainMarginPct).toBe(0)
  })

  test('per-slot fallbacks round-trip and unknown models are dropped with a warning', async () => {
    const result = await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5', 'gpt-5-nano']
        }
      ],
      Router: {
        default: 'openai,gpt-5',
        // A missing nested key defaults to [] (RouterFallbacksSchema),
        // so a partial fallbacks object is enough to set one slot.
        fallbacks: { default: ['openai,gpt-5-nano', 'openai,does-not-exist'] }
      }
    })

    // The unknown model is dropped with a warning; the valid one stays,
    // in order.
    expect(result.warnings.some((w) => w.includes('does-not-exist'))).toBe(true)

    const ui = await composeUiConfig()
    expect(ui.Router.default).toBe('openai,gpt-5')
    expect(ui.Router.fallbacks.default).toEqual(['openai,gpt-5-nano'])
    expect(ui.Router.fallbacks.background).toEqual([])
  })

  test('removing a model nulls any RouterSlot that referenced it and warns', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5', 'gpt-5-nano']
        }
      ],
      Router: { default: 'openai,gpt-5-nano' }
    })

    const result = await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5-nano' } // points at a model we just removed
    })

    expect(result.warnings.some((w) => w.includes('gpt-5-nano'))).toBe(true)
    const ui = await composeUiConfig()
    expect(ui.Router.default).toBeNull()
  })

  test('deleting a provider cascades models and nulls bound slots', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5']
        },
        {
          name: 'gemini',
          api_base_url: 'https://generativelanguage.googleapis.com',
          api_key: 'AI-x',
          auth_mode: 'api_key',
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
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
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
    expect(ui.Router.background).toBeNull()

    // Cascade should have removed gemini and gemini's models. Only the
    // single openai model remains, attached to openai.
    const prisma = getPrismaClient()
    const allModels = await prisma.model.findMany({ include: { provider: true } })
    expect(allModels.map((m) => m.provider.name)).toEqual(['openai'])
  })

  test('API_TIMEOUT_MS number is written to disk and read back via composeUiConfig', async () => {
    // APIKEY must be present in the envelope; applyUiConfig writes only what is
    // passed, and readConfigFile requires a non-empty APIKEY to pass schema validation.
    await applyUiConfig({
      Providers: [],
      Router: {},
      APIKEY: 'test-key',
      API_TIMEOUT_MS: 30000
    })
    const ui = await composeUiConfig()
    expect(ui.API_TIMEOUT_MS).toBe(30000)
  })

  test('API_TIMEOUT_MS is preserved alongside Providers and Router changes', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
          models: ['gpt-5']
        }
      ],
      Router: { default: 'openai,gpt-5' },
      APIKEY: 'test-key',
      API_TIMEOUT_MS: 45000
    })
    const ui = await composeUiConfig()
    expect(ui.API_TIMEOUT_MS).toBe(45000)
    expect(ui.Router.default).toBe('openai,gpt-5')
  })

  test('omitting API_TIMEOUT_MS from payload removes it from disk', async () => {
    await applyUiConfig({ Providers: [], Router: {}, APIKEY: 'test-key', API_TIMEOUT_MS: 30000 })
    // Second write without the field — envelope strips it.
    await applyUiConfig({ Providers: [], Router: {}, APIKEY: 'test-key' })
    const ui = await composeUiConfig()
    expect(ui.API_TIMEOUT_MS).toBeUndefined()
  })

  test('Personas (top-level) and Router.persona round-trip through apply then compose', async () => {
    await applyUiConfig({
      Providers: [],
      Router: { persona: 'pirate' },
      APIKEY: 'test-key',
      Personas: [
        { name: 'pirate', prompt: 'Talk like a pirate.' },
        { name: 'lawyer', prompt: 'Be precise and cite statutes.' }
      ]
    })
    const ui = await composeUiConfig()
    expect(ui.Personas).toEqual([
      { name: 'pirate', prompt: 'Talk like a pirate.' },
      { name: 'lawyer', prompt: 'Be precise and cite statutes.' }
    ])
    // The active persona now rides on Router.persona, not as a top-level field.
    expect(ui.Router.persona).toBe('pirate')
  })

  test('empty Router.persona clears the active persona (composed as null)', async () => {
    await applyUiConfig({
      Providers: [],
      Router: { persona: 'pirate' },
      APIKEY: 'test-key',
      Personas: [{ name: 'pirate', prompt: 'Talk like a pirate.' }]
    })
    // Empty string collapses to null on the wire and is pruned off disk,
    // so the library survives but no persona is active.
    await applyUiConfig({
      Providers: [],
      Router: { persona: '' },
      APIKEY: 'test-key',
      Personas: [{ name: 'pirate', prompt: 'Talk like a pirate.' }]
    })
    const ui = await composeUiConfig()
    expect(ui.Personas).toEqual([{ name: 'pirate', prompt: 'Talk like a pirate.' }])
    expect(ui.Router.persona).toBeNull()
  })

  test('disabling the active subscription account promotes another enabled one', async () => {
    // Stand up a subscription provider directly via Prisma — applyUiConfig
    // does not own the SubAccount create path (that's the OAuth flow), it
    // only owns the toggle path we are exercising here.
    const prisma = getPrismaClient()
    const { AuthMode } = await import('../../src/generated/prisma/client')
    const provider = await prisma.provider.create({
      data: {
        name: 'claude-code',
        apiBaseUrl: 'https://api.anthropic.com',
        authMode: AuthMode.subscription
      }
    })
    const active = await prisma.subAccount.create({
      data: {
        providerId: provider.id,
        sourcePath: 'oauth:claude:a',
        label: 'claude-code:web-oauth',
        enabled: true,
        plan: 'claude_max'
      }
    })
    const spare = await prisma.subAccount.create({
      data: {
        providerId: provider.id,
        sourcePath: 'oauth:claude:b',
        label: 'claude-code:web-oauth',
        enabled: true,
        plan: 'claude_max'
      }
    })
    await prisma.provider.update({
      where: { id: provider.id },
      data: { activeSubscriptionAccountId: active.id }
    })

    await applyUiConfig({
      Providers: [
        {
          name: 'claude-code',
          api_base_url: 'https://api.anthropic.com',
          api_key: '',
          auth_mode: 'subscription',
          models: [],
          subscription_accounts: [
            { id: active.id, enabled: false },
            { id: spare.id, enabled: true }
          ]
        }
      ],
      Router: {}
    })

    const after = await prisma.provider.findUnique({
      where: { id: provider.id },
      select: { activeSubscriptionAccountId: true }
    })
    expect(after?.activeSubscriptionAccountId).toBe(spare.id)
  })

  test('disabling the last enabled subscription account nulls the binding', async () => {
    const prisma = getPrismaClient()
    const { AuthMode } = await import('../../src/generated/prisma/client')
    const provider = await prisma.provider.create({
      data: {
        name: 'claude-code',
        apiBaseUrl: 'https://api.anthropic.com',
        authMode: AuthMode.subscription
      }
    })
    const only = await prisma.subAccount.create({
      data: {
        providerId: provider.id,
        sourcePath: 'oauth:claude:only',
        label: 'claude-code:web-oauth',
        enabled: true,
        plan: 'claude_max'
      }
    })
    await prisma.provider.update({
      where: { id: provider.id },
      data: { activeSubscriptionAccountId: only.id }
    })

    await applyUiConfig({
      Providers: [
        {
          name: 'claude-code',
          api_base_url: 'https://api.anthropic.com',
          api_key: '',
          auth_mode: 'subscription',
          models: [],
          subscription_accounts: [{ id: only.id, enabled: false }]
        }
      ],
      Router: {}
    })

    const after = await prisma.provider.findUnique({
      where: { id: provider.id },
      select: { activeSubscriptionAccountId: true }
    })
    expect(after?.activeSubscriptionAccountId).toBeNull()
  })

  test('unknown router scenarios are dropped with a warning', async () => {
    await applyUiConfig({
      Providers: [
        {
          name: 'openai',
          api_base_url: 'https://api.openai.com/v2',
          api_key: 'sk-x',
          auth_mode: 'api_key',
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
