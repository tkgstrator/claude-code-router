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

export async function applyRouter(tx: Tx, incoming: Partial<Router>, warnings: string[]): Promise<void> {
  const longContextThreshold = typeof incoming.longContextThreshold === 'number' ? incoming.longContextThreshold : null
  // weeklyDrainMarginPct rides on the default slot's params. 0 means
  // "policy at its default" and is treated as "drop the key" so we don't
  // store noise. Negative / out-of-range / non-integer values are
  // ignored — applyUiConfig already round-trips the RouterSchema which
  // clamps to int 0..100, but this is the defence-in-depth path.
  const incomingMargin =
    typeof incoming.weeklyDrainMarginPct === 'number' &&
    Number.isInteger(incoming.weeklyDrainMarginPct) &&
    incoming.weeklyDrainMarginPct > 0 &&
    incoming.weeklyDrainMarginPct <= 100
      ? incoming.weeklyDrainMarginPct
      : null

  for (const scenario of SCENARIO_KEYS) {
    const { providerName, modelName } = parseSlot(incoming[scenario])

    let modelId: string | null = null
    if (providerName && modelName) {
      const model = await tx.model.findFirst({
        where: { name: modelName, provider: { name: providerName } }
      })
      if (model) {
        modelId = model.id
      } else {
        warnings.push(`Router slot "${scenario}" references unknown model "${providerName},${modelName}"; left empty.`)
      }
    }

    const fallbacks = await resolveFallbackTargets(tx, scenario, incoming.fallbacks?.[scenario], warnings, providerName)

    // params holds the scenario-scoped knobs: longContext keeps its
    // threshold; default keeps the Router-wide weeklyDrainMarginPct
    // policy knob (it rides on default because the policy applies
    // globally and the default slot is always present); any slot may
    // carry a fallbacks chain. An empty object collapses to DbNull so a
    // slot with no knobs stores NULL.
    const paramsObj: Prisma.InputJsonObject = {
      ...(scenario === 'longContext' && longContextThreshold !== null ? { threshold: longContextThreshold } : {}),
      ...(scenario === 'default' && incomingMargin !== null ? { weeklyDrainMarginPct: incomingMargin } : {}),
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
      // image has no runtime routing lane, so it never carries force.
      ...(scenario !== 'image' && incoming.force?.[scenario] === true ? { force: true } : {})
    }
    const params: Prisma.InputJsonValue | typeof Prisma.DbNull =
      Object.keys(paramsObj).length > 0 ? paramsObj : Prisma.DbNull

    await tx.routerSlot.upsert({
      where: { scenario },
      update: { modelId, params },
      create: { scenario, modelId, params }
    })
  }

  // Surface any catchall (custom) keys we silently drop.
  const knownKeys = new Set<string>([
    ...SCENARIO_KEYS,
    'longContextThreshold',
    'weeklyDrainMarginPct',
    'fallbacks',
    'force'
  ])
  const dropped = Object.keys(incoming).filter((k) => !knownKeys.has(k))
  if (dropped.length > 0) {
    warnings.push(`Router fields not yet stored in DB and were ignored: ${dropped.join(', ')}. (See PR #2.)`)
  }
}
