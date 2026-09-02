import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { getPrismaClient } from '../../../src/db/client'
import { SolverInputSchema } from '../../../src/schemas/domain/solver-input'
import { collectSolverInput } from '../../../src/services/solver/collect-input'
import { HAS_DB, resetDbTables, teardownPrisma } from '../../db/helpers'

const describeOrSkip = HAS_DB ? describe : describe.skip

describeOrSkip('collectSolverInput (DB)', () => {
  beforeEach(async () => {
    await resetDbTables()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('empty DB → empty scenarios / targets / accounts, generatedAt is ISO', async () => {
    const out = await collectSolverInput(4)
    expect(out.windowHours).toBe(4)
    expect(out.scenarios).toEqual([])
    expect(out.targets).toEqual([])
    expect(out.accounts).toEqual([])
    // Full-shape validation (isoDatetime, positive windowHours, etc.).
    expect(SolverInputSchema.safeParse(out).success).toBe(true)
  })

  test('aggregates per-scenario counts / avg / p95 / err splits, drops legacy scenarios', async () => {
    const prisma = getPrismaClient()
    const session = await prisma.session.create({ data: { id: 'sess-agg' } })
    await prisma.requestLog.createMany({
      data: [
        // default: 3 rows, one 429, one other-error, one success.
        {
          sessionId: session.id,
          provider: 'p',
          model: 'm',
          scenario: 'default',
          inputTokens: 100,
          outputTokens: 10,
          status: 200
        },
        {
          sessionId: session.id,
          provider: 'p',
          model: 'm',
          scenario: 'default',
          inputTokens: 200,
          outputTokens: 20,
          status: 429
        },
        {
          sessionId: session.id,
          provider: 'p',
          model: 'm',
          scenario: 'default',
          inputTokens: 300,
          outputTokens: 30,
          status: 500
        },
        // think: 1 row, success.
        {
          sessionId: session.id,
          provider: 'p',
          model: 'm',
          scenario: 'think',
          inputTokens: 400,
          outputTokens: 40,
          status: 200
        },
        // Legacy 'background' scenario — must be dropped.
        {
          sessionId: session.id,
          provider: 'p',
          model: 'm',
          scenario: 'background',
          inputTokens: 999,
          outputTokens: 0,
          status: 200
        }
      ]
    })

    const out = await collectSolverInput(24)
    const scenarios = out.scenarios
    // 'background' filtered out, only default + think survive.
    expect(scenarios.map((s) => s.scenario).sort()).toEqual(['default', 'think'])

    const dflt = scenarios.find((s) => s.scenario === 'default')
    expect(dflt).toBeDefined()
    if (dflt === undefined) throw new Error('unreachable')
    expect(dflt.requestCount).toBe(3)
    expect(dflt.avgInputTokens).toBe(200) // (100+200+300)/3
    expect(dflt.err429Count).toBe(1)
    expect(dflt.errOtherCount).toBe(1)
    expect(dflt.totalOutputTokens).toBe(60)
    // p95 with 3 samples via PERCENTILE_CONT is a linear interpolation
    // near the top of the range — must land above the avg and at/under max.
    expect(dflt.p95InputTokens).toBeGreaterThan(200)
    expect(dflt.p95InputTokens).toBeLessThanOrEqual(300)

    const think = scenarios.find((s) => s.scenario === 'think')
    expect(think).toBeDefined()
    if (think === undefined) throw new Error('unreachable')
    expect(think.requestCount).toBe(1)
    expect(think.avgInputTokens).toBe(400)
    expect(think.err429Count).toBe(0)
    expect(think.errOtherCount).toBe(0)
  })

  test('per-target rows carry contextWindow + prices and chain memberships', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({
      data: {
        providerId: provider.id,
        name: 'sonnet-9',
        enabled: true,
        contextWindow: 200000,
        inputPer1M: 3.0,
        outputPer1M: 15.0
      }
    })
    const secondModel = await prisma.model.create({
      data: {
        providerId: provider.id,
        name: 'opus-9',
        enabled: true,
        contextWindow: 400000,
        inputPer1M: 15.0,
        outputPer1M: 75.0
      }
    })

    // Wire opus-9 into the `think` scenario preference chain (priority 1).
    const profile = await prisma.routerPreferenceProfile.create({
      data: { key: 'live' }
    })
    await prisma.routerPreferenceEntry.create({
      data: {
        profileId: profile.id,
        scenario: 'think',
        priority: 1,
        modelId: secondModel.id,
        enabled: true,
        kind: 'subagent'
      }
    })

    // Observed traffic on opus-9 (2 rows, one 429).
    const session = await prisma.session.create({ data: { id: 'sess-target' } })
    await prisma.requestLog.createMany({
      data: [
        {
          sessionId: session.id,
          provider: 'anthropic',
          model: 'opus-9',
          scenario: 'think',
          inputTokens: 500,
          outputTokens: 50,
          status: 200
        },
        {
          sessionId: session.id,
          provider: 'anthropic',
          model: 'opus-9',
          scenario: 'think',
          inputTokens: 250,
          outputTokens: 25,
          status: 429
        }
      ]
    })

    const out = await collectSolverInput(24)
    // Sorted by target key, so opus < sonnet alphabetically.
    const opusTarget = out.targets.find((t) => t.target === 'anthropic,opus-9')
    const sonnetTarget = out.targets.find((t) => t.target === 'anthropic,sonnet-9')
    expect(opusTarget).toBeDefined()
    expect(sonnetTarget).toBeDefined()
    if (opusTarget === undefined || sonnetTarget === undefined) throw new Error('unreachable')

    expect(opusTarget.contextWindow).toBe(400000)
    expect(opusTarget.inputPer1M).toBe(15.0)
    expect(opusTarget.outputPer1M).toBe(75.0)
    expect(opusTarget.chainMemberships).toEqual([{ scenario: 'think', kind: 'subagent', priority: 1, enabled: true }])
    expect(opusTarget.observed.requestCount).toBe(2)
    expect(opusTarget.observed.totalInputTokens).toBe(750)
    expect(opusTarget.observed.totalOutputTokens).toBe(75)
    expect(opusTarget.observed.err429Count).toBe(1)

    // sonnet-9 has no chain membership + no traffic — must still emit an empty observed row.
    expect(sonnetTarget.chainMemberships).toEqual([])
    expect(sonnetTarget.observed).toEqual({
      requestCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      err429Count: 0
    })
  })

  test('accounts include subscription providers only; api_key SubAccounts are skipped', async () => {
    const prisma = getPrismaClient()
    const claudeProvider = await prisma.provider.create({
      data: {
        name: 'claude-code',
        apiBaseUrl: 'https://api.anthropic.com',
        authMode: 'subscription',
        apiStyle: 'anthropic'
      }
    })
    const apiKeyProvider = await prisma.provider.create({
      data: {
        name: 'openai',
        apiBaseUrl: 'https://api.openai.com',
        authMode: 'api_key',
        apiStyle: 'openai_chat'
      }
    })
    const claudeAccount = await prisma.subAccount.create({
      data: {
        providerId: claudeProvider.id,
        sourcePath: '/tmp/claude-1.json',
        label: 'primary',
        userEmail: 'a@example.com'
      }
    })
    await prisma.subAccount.create({
      data: {
        providerId: apiKeyProvider.id,
        sourcePath: '/tmp/openai-1.json',
        label: 'openai-key'
      }
    })
    await prisma.subAccountQuota.create({
      data: {
        subAccountId: claudeAccount.id,
        fiveHourUsed: 42,
        fiveHourLimit: 100,
        fiveHourResetAt: new Date('2026-08-13T15:00:00.000Z'),
        fiveHourWindowSeconds: 18000,
        weeklyUsed: 12,
        weeklyLimit: 100,
        weeklyResetAt: new Date('2026-08-20T00:00:00.000Z'),
        weeklyWindowSeconds: 7 * 24 * 3600,
        quotaRefreshedAt: new Date('2026-08-13T10:00:00.000Z')
      }
    })

    const out = await collectSolverInput(4)
    expect(out.accounts).toHaveLength(1)
    const [row] = out.accounts
    expect(row.providerName).toBe('claude-code')
    expect(row.kind).toBe('claude')
    expect(row.fiveHour).toEqual({
      used: 42,
      limit: 100,
      resetAt: '2026-08-13T15:00:00.000Z',
      windowLengthMs: 18000 * 1000
    })
    expect(row.weekly).toEqual({
      used: 12,
      limit: 100,
      resetAt: '2026-08-20T00:00:00.000Z',
      windowLengthMs: 7 * 24 * 3600 * 1000
    })
    expect(row.refreshedAt).toBe('2026-08-13T10:00:00.000Z')

    // Whole payload still validates against the wire schema.
    expect(SolverInputSchema.safeParse(out).success).toBe(true)
  })
})
