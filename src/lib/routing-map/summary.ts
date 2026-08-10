/**
 * Compact scenario→model summaries for the Routing Library grid cards.
 * Same source of truth (RouterConfig) as the React Flow editor — a card
 * is essentially the editor rendered as a text list.
 */

import { modelNameOf } from '@/lib/router/fallback-slots'
import type { RouterConfig } from '@/schemas'
import { EDIT_SCENARIOS, type EditScenario } from './edit-graph'

export interface ScenarioSummaryRow {
  scenario: EditScenario
  // Agent-lane primary model name (post modelNameOf normalization), or
  // null when the slot is unwired for the agent lane.
  agent: string | null
  // Subagent-lane primary model name. Kept alongside `agent` because
  // subagents can route to a different model than the main agent within
  // the same scenario.
  subagent: string | null
  // How many extra targets (fallback chain + rules) each lane carries.
  // Rendered as "+N" chips so a summary card can hint at complexity
  // without listing every entry.
  agentExtras: number
  subagentExtras: number
}

// Read the primary + count-of-extras (fallbacks + rules) for one lane
// of one scenario. Extras roll fallbacks and rules together — the grid
// card just needs a "there's more here" signal, not an exact breakdown.
function summarizeLane(route: { primary: string | null; fallbacks: string[]; rules: unknown[] }): {
  primary: string | null
  extras: number
} {
  return {
    primary: route.primary === null ? null : modelNameOf(route.primary),
    extras: route.fallbacks.length + route.rules.length
  }
}

export function summarizeRouter(config: RouterConfig): ScenarioSummaryRow[] {
  return EDIT_SCENARIOS.map((scenario) => {
    const agent = summarizeLane(config[scenario].agent)
    const subagent = summarizeLane(config[scenario].subagent)
    return {
      scenario,
      agent: agent.primary,
      subagent: subagent.primary,
      agentExtras: agent.extras,
      subagentExtras: subagent.extras
    }
  })
}
