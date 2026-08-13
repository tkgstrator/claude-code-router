/**
 * Push a router snapshot onto the live routing (RouterSlot) via
 * /api/config. Shared between the Library grid's "Apply to Live" action
 * and the Preset editor's header button so both surfaces behave
 * identically (same failure surface, same success payload).
 *
 * Returns a discriminated result rather than throwing so callers can
 * keep their handlers flat — no nested try/catch or `?.` on `res.success`.
 */

import { api } from '@/lib/api'
import type { RouterConfig } from '@/schemas'
import type { Config } from '@/types'

export type ApplyResult = { ok: true; updatedConfig: Config } | { ok: false; message: string }

// Push a preset onto the live routing. `presetName` is folded into the
// envelope's LiveRoutingName so the Live card's display label reads as
// "Work" instead of the generic "Live" — a lightweight source-of-truth
// signal without the schema surface of an explicit activePresetId column.
// Callers that don't want the name to change (e.g. renaming Live directly)
// should not go through this helper.
export async function applyPresetToLive(
  liveConfig: Config,
  draft: RouterConfig,
  presetName: string
): Promise<ApplyResult> {
  const updated = { ...liveConfig, Router: draft, LiveRoutingName: presetName }
  try {
    const res = await api.updateConfig(updated)
    if (typeof res === 'object' && res !== null && 'success' in res && res.success === false) {
      const message = 'message' in res && typeof res.message === 'string' ? res.message : 'update failed'
      return { ok: false, message }
    }
    return { ok: true, updatedConfig: updated }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
