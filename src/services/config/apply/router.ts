/**
 * Validate and persist the six RouterSlot rows from the UI's incoming
 * Router payload, including per-scenario fallback chains.
 */

import type { Router } from '@/schemas'
import { SCENARIO_KEYS } from '@/shared'
import { Prisma } from '../../../generated/prisma/client'
import type { Tx } from '../apply'
import { parseSlot } from './fields'

// Validate a scenario's incoming fallback list against the DB: keep the
// entries that resolve to a known provider/model (preserving order),
// drop the rest with a warning. Mirrors the primary-slot validation so
// the stored chain only ever points at models that actually exist.
//
// `primaryProviderName` is the provider name on the scenario's primary
// slot; fallback entries on the SAME provider are dropped, because
// same-provider fallbacks cannot help with per-account quota 429s — the
// 5h/weekly windows apply across all models of an account. The user
// should reach for a different provider (another subscription org, or
// an api_key provider in another scenario slot) instead.
export async function resolveFallbackTargets(
  tx: Tx,
  scenario: string,
  raw: readonly string[] | undefined,
  warnings: string[],
  primaryProviderName: string | null
): Promise<string[]> {
  if (raw === undefined || raw.length === 0) return []
  const out: string[] = []
  for (const entry of raw) {
    const { providerName, modelName } = parseSlot(entry)
    if (!providerName || !modelName) {
      warnings.push(`Router fallback for "${scenario}" is malformed ("${entry}"); dropped.`)
      continue
    }
    if (primaryProviderName !== null && providerName === primaryProviderName) {
      warnings.push(
        `Router fallback "${providerName},${modelName}" for "${scenario}" is on the same provider as the primary; dropped (use a different provider).`
      )
      continue
    }
    const model = await tx.model.findFirst({
      where: { name: modelName, provider: { name: providerName } }
    })
    if (!model) {
      warnings.push(
        `Router fallback "${providerName},${modelName}" for "${scenario}" references unknown model; dropped.`
      )
      continue
    }
    out.push(`${providerName},${modelName}`)
  }
  return out
}

// Assemble the scenario-scoped params JSON for a RouterSlot row:
// longContext keeps its threshold; any slot may carry the two fallback
// chains (`fallbacks` for the agent route, `subagentFallbacks` for the
// subagent route). An empty object collapses to DbNull so a slot with no
// knobs stores NULL.
function buildSlotParams(args: {
  scenario: string
  fallbacks: string[]
  subagentFallbacks: string[]
  longContextThreshold: number | null
}): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const { scenario, fallbacks, subagentFallbacks, longContextThreshold } = args
  const paramsObj: Prisma.InputJsonObject = {
    ...(scenario === 'longContext' && longContextThreshold !== null ? { threshold: longContextThreshold } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
    ...(subagentFallbacks.length > 0 ? { subagentFallbacks } : {})
  }
  return Object.keys(paramsObj).length > 0 ? paramsObj : Prisma.DbNull
}

// Resolve one route's primary "provider,model" string to a Model id, or
// null when unset / unknown. `kind` labels the warning so the operator
// can tell which route (agent / subagent) dropped a bad reference.
async function resolvePrimaryModelId(
  tx: Tx,
  scenario: string,
  primary: string | null | undefined,
  kind: 'agent' | 'subagent',
  warnings: string[]
): Promise<string | null> {
  const { providerName, modelName } = parseSlot(primary)
  if (!providerName || !modelName) return null
  const model = await tx.model.findFirst({
    where: { name: modelName, provider: { name: providerName } }
  })
  if (model) return model.id
  warnings.push(
    `Router ${kind} slot "${scenario}" references unknown model "${providerName},${modelName}"; left empty.`
  )
  return null
}

export async function applyRouter(tx: Tx, incoming: Partial<Router>, warnings: string[]): Promise<void> {
  const longContextThreshold =
    typeof incoming.longContext?.threshold === 'number' ? incoming.longContext.threshold : null

  for (const scenario of SCENARIO_KEYS) {
    const route = incoming[scenario]

    // Resolve the agent and subagent primaries independently.
    const modelId = await resolvePrimaryModelId(tx, scenario, route?.agent?.primary, 'agent', warnings)
    const subagentModelId = await resolvePrimaryModelId(tx, scenario, route?.subagent?.primary, 'subagent', warnings)

    // Validate each route's fallback chain against ITS OWN primary — the
    // same-provider-as-primary drop rule applies per route.
    const agentPrimaryProvider = parseSlot(route?.agent?.primary).providerName
    const subagentPrimaryProvider = parseSlot(route?.subagent?.primary).providerName
    const fallbacks = await resolveFallbackTargets(
      tx,
      scenario,
      route?.agent?.fallbacks,
      warnings,
      agentPrimaryProvider
    )
    const subagentFallbacks = await resolveFallbackTargets(
      tx,
      scenario,
      route?.subagent?.fallbacks,
      warnings,
      subagentPrimaryProvider
    )

    const params = buildSlotParams({
      scenario,
      fallbacks,
      subagentFallbacks,
      longContextThreshold
    })

    await tx.routerSlot.upsert({
      where: { scenario },
      update: { modelId, subagentModelId, params },
      create: { scenario, modelId, subagentModelId, params }
    })
  }

  // Surface any catchall (custom) keys we silently drop. In the nested
  // shape the only top-level Router keys are the six scenarios plus the
  // persona (lifted to the disk envelope by splitPayload before this).
  const knownKeys = new Set<string>([...SCENARIO_KEYS, 'persona'])
  const dropped = Object.keys(incoming).filter((k) => !knownKeys.has(k))
  if (dropped.length > 0) {
    warnings.push(`Router fields not yet stored in DB and were ignored: ${dropped.join(', ')}.`)
  }
}
