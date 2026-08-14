/**
 * Collect the offline routing planner's input snapshot (Phase A).
 *
 * Reads three DB surfaces and produces a pure `SolverInput` object a
 * future `javascript-lp-solver`-backed phase will consume:
 *
 *   - RequestLog: per-scenario aggregate (count / avg + p95 input
 *     tokens / total output tokens / 429 + other-error counts) and
 *     per-target aggregate (count / totals / 429s) over the last
 *     `windowHours`.
 *   - Model: contextWindow + inputPer1M + outputPer1M for every
 *     preference-chain target the solver may reason about.
 *   - RouterPreferenceProfile / RouterPreferenceEntry: chain
 *     membership so the solver knows which scenarios each target
 *     currently participates in.
 *   - SubAccountQuota: per-account 5h / weekly window state for
 *     subscription-auth providers. api_key providers have no per-window
 *     budget so they're skipped upstream.
 *
 * Pure(-ish): the DB read is a side effect but the return value is a
 * plain JSON-serialisable object. Callers can override `prisma` for
 * tests.
 */

import { getPrismaClient } from '../../db/client'
import type { PrismaClient } from '../../generated/prisma/client'
import dayjs from '../../lib/dayjs'
import type {
  SolverInput,
  SolverInputAccount,
  SolverInputChainMembership,
  SolverInputScenario,
  SolverInputTarget
} from '../../schemas'
import type { ScenarioKey } from '../../schemas/router.dto'

const VALID_SCENARIOS: readonly ScenarioKey[] = ['default', 'think', 'longContext', 'webSearch', 'image']

// Type guard that narrows a nullable/unknown scenario string coming
// out of `RequestLog.scenario` (a nullable String column, not enum-
// restricted at the DB level) into the current ScenarioKey union.
// Historical 'background' rows fall through as false.
const asScenarioKey = (raw: string | null): ScenarioKey | null => {
  if (raw === null) return null
  const match = VALID_SCENARIOS.find((s) => s === raw)
  return match === undefined ? null : match
}

// Per-scenario aggregate row shape returned by the raw query.
interface PerScenarioRawRow {
  scenario: string | null
  request_count: bigint
  avg_input: number | null
  p95_input: number | null
  total_output: bigint
  err_429: bigint
  err_other: bigint
}

// Per-target aggregate row shape returned by the raw query.
interface PerTargetRawRow {
  provider: string
  model: string
  request_count: bigint
  total_input: bigint
  total_output: bigint
  err_429: bigint
}

async function loadPerScenario(prisma: PrismaClient, windowHours: number): Promise<SolverInputScenario[]> {
  const rows = await prisma.$queryRawUnsafe<PerScenarioRawRow[]>(
    `SELECT scenario,
            COUNT(*)::bigint                                                                          AS request_count,
            COALESCE(AVG("inputTokens"), 0)::float8                                                   AS avg_input,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "inputTokens"), 0)::float8          AS p95_input,
            COALESCE(SUM("outputTokens"), 0)::bigint                                                  AS total_output,
            COUNT(*) FILTER (WHERE status = 429)::bigint                                              AS err_429,
            COUNT(*) FILTER (WHERE status >= 400 AND status <> 429)::bigint                           AS err_other
     FROM "RequestLog"
     WHERE "createdAt" > NOW() - $1::interval
     GROUP BY scenario`,
    `${windowHours} hours`
  )
  // Restrict to the current ScenarioKey enum. Legacy 'background' rows
  // (see SCENARIO_KEYS comment in shared/db/types) fall through here;
  // the solver only reasons about scenarios that still exist.
  const filtered: SolverInputScenario[] = []
  for (const row of rows) {
    const scenario = asScenarioKey(row.scenario)
    if (scenario === null) continue
    filtered.push({
      scenario,
      requestCount: Number(row.request_count),
      avgInputTokens: row.avg_input === null ? 0 : Number(row.avg_input),
      p95InputTokens: row.p95_input === null ? 0 : Number(row.p95_input),
      totalOutputTokens: Number(row.total_output),
      err429Count: Number(row.err_429),
      errOtherCount: Number(row.err_other)
    })
  }
  return filtered.sort((a, b) => a.scenario.localeCompare(b.scenario))
}

async function loadPerTargetObserved(
  prisma: PrismaClient,
  windowHours: number
): Promise<Map<string, SolverInputTarget['observed']>> {
  const rows = await prisma.$queryRawUnsafe<PerTargetRawRow[]>(
    `SELECT provider,
            model,
            COUNT(*)::bigint                              AS request_count,
            COALESCE(SUM("inputTokens"), 0)::bigint       AS total_input,
            COALESCE(SUM("outputTokens"), 0)::bigint      AS total_output,
            COUNT(*) FILTER (WHERE status = 429)::bigint  AS err_429
     FROM "RequestLog"
     WHERE "createdAt" > NOW() - $1::interval
     GROUP BY provider, model`,
    `${windowHours} hours`
  )
  const out = new Map<string, SolverInputTarget['observed']>()
  for (const row of rows) {
    const key = `${row.provider},${row.model}`
    out.set(key, {
      requestCount: Number(row.request_count),
      totalInputTokens: Number(row.total_input),
      totalOutputTokens: Number(row.total_output),
      err429Count: Number(row.err_429)
    })
  }
  return out
}

// Load every (provider, model) row Prisma knows about plus each
// model's current preference-chain membership. Emits one solver-input
// target row per Model — the solver reasons about every model the
// operator has configured, not just those that carried traffic in the
// window (a model with zero observations is still a candidate).
async function loadTargets(prisma: PrismaClient, windowHours: number): Promise<SolverInputTarget[]> {
  const [models, profile, observedByTarget] = await Promise.all([
    prisma.model.findMany({
      include: { provider: { select: { name: true } } }
    }),
    prisma.routerPreferenceProfile.findUnique({
      where: { key: 'live' },
      include: {
        entries: {
          orderBy: [{ scenario: 'asc' }, { priority: 'asc' }],
          include: { model: { include: { provider: { select: { name: true } } } } }
        }
      }
    }),
    loadPerTargetObserved(prisma, windowHours)
  ])

  const membershipsByTarget = new Map<string, SolverInputChainMembership[]>()
  if (profile !== null) {
    for (const entry of profile.entries) {
      const target = `${entry.model.provider.name},${entry.model.name}`
      const scenario: ScenarioKey = entry.scenario
      const existing = membershipsByTarget.get(target)
      const membership: SolverInputChainMembership = {
        scenario,
        priority: entry.priority,
        enabled: entry.enabled,
        subagentTiers: [...entry.subagentTiers]
      }
      if (existing === undefined) membershipsByTarget.set(target, [membership])
      else existing.push(membership)
    }
  }

  const emptyObserved: SolverInputTarget['observed'] = {
    requestCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    err429Count: 0
  }

  const targets: SolverInputTarget[] = models.map((m) => {
    const target = `${m.provider.name},${m.name}`
    const observed = observedByTarget.get(target)
    const memberships = membershipsByTarget.get(target)
    return {
      target,
      provider: m.provider.name,
      model: m.name,
      contextWindow: m.contextWindow,
      inputPer1M: m.inputPer1M,
      outputPer1M: m.outputPer1M,
      chainMemberships: memberships === undefined ? [] : memberships,
      observed: observed === undefined ? emptyObserved : observed
    }
  })

  return targets.sort((a, b) => a.target.localeCompare(b.target))
}

// Normalise one used/limit/resetAt/windowSeconds tuple into the wire
// shape (or null when either bound is missing). Extracted so the
// per-account transform below stays under the cognitive-complexity
// ceiling — the two window kinds (5h / weekly) share identical logic.
const buildQuotaWindow = (
  used: number | null,
  limit: number | null,
  resetAt: Date | null,
  windowSeconds: number | null
): SolverInputAccount['fiveHour'] => {
  if (used === null || limit === null) return null
  return {
    used,
    limit,
    resetAt: resetAt === null ? null : dayjs(resetAt).toISOString(),
    windowLengthMs: windowSeconds === null ? null : windowSeconds * 1000
  }
}

interface SubAccountRowLite {
  id: string
  provider: { name: string; authMode: 'api_key' | 'subscription' }
  quota: {
    fiveHourUsed: number | null
    fiveHourLimit: number | null
    fiveHourResetAt: Date | null
    fiveHourWindowSeconds: number | null
    weeklyUsed: number | null
    weeklyLimit: number | null
    weeklyResetAt: Date | null
    weeklyWindowSeconds: number | null
    quotaRefreshedAt: Date | null
  } | null
}

const rowToAccount = (a: SubAccountRowLite): SolverInputAccount => {
  const kind: 'claude' | 'codex' = a.provider.name.toLowerCase().includes('codex') ? 'codex' : 'claude'
  const q = a.quota
  const fiveHour =
    q === null ? null : buildQuotaWindow(q.fiveHourUsed, q.fiveHourLimit, q.fiveHourResetAt, q.fiveHourWindowSeconds)
  const weekly =
    q === null ? null : buildQuotaWindow(q.weeklyUsed, q.weeklyLimit, q.weeklyResetAt, q.weeklyWindowSeconds)
  const refreshedAt = q === null || q.quotaRefreshedAt === null ? null : dayjs(q.quotaRefreshedAt).toISOString()
  return {
    subAccountId: a.id,
    providerName: a.provider.name,
    kind,
    fiveHour,
    weekly,
    refreshedAt
  }
}

async function loadAccounts(prisma: PrismaClient): Promise<SolverInputAccount[]> {
  const rows = await prisma.subAccount.findMany({
    include: { provider: true, quota: true }
  })
  return rows
    .filter((a) => a.provider.authMode === 'subscription')
    .map((a) => rowToAccount(a))
    .sort((a, b) => a.subAccountId.localeCompare(b.subAccountId))
}

export async function collectSolverInput(windowHours: number, prisma?: PrismaClient): Promise<SolverInput> {
  const client = prisma === undefined ? getPrismaClient() : prisma
  const [scenarios, targets, accounts] = await Promise.all([
    loadPerScenario(client, windowHours),
    loadTargets(client, windowHours),
    loadAccounts(client)
  ])
  return {
    generatedAt: dayjs().toISOString(),
    windowHours,
    scenarios,
    targets,
    accounts
  }
}
