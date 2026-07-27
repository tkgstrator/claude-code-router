import { z } from '@hono/zod-openapi'
import { SCENARIO_KEYS } from '@/shared/db/types'
import { EmptyStringToNullSchema } from './common.dto'

// --- Scenario route (nested) ------------------------------------------------

// A fallback-chain entry: a non-empty "providerName,modelName" string.
// Order is meaningful — the router walks the list in sequence when the
// primary is rate-limited (proactively on a high usage percentage, or
// reactively on a 429). Same-provider-as-primary entries are rejected
// downstream (applyRouter / the UI option filter), not here.
const FallbackEntrySchema = z.string().nonempty()

// A single route target: the primary model reference plus its ordered
// fallback chain. `primary` is the "providerName,modelName" reference or
// null ('' folds to null on parse); `fallbacks` is the failover chain the
// runtime walks when the primary is rate-limited. Every scenario carries
// two of these — one per caller kind (agent / subagent).
export const RouteTargetSchema = z
  .object({
    primary: EmptyStringToNullSchema.default(null),
    fallbacks: z.array(FallbackEntrySchema).default([])
  })
  .openapi('RouteTarget')

// The fields every scenario shares: TWO routes keyed by caller kind.
// `agent` handles normal / main-agent traffic; `subagent` handles a
// request carrying a <CCR-SUBAGENT-MODEL> tag. selectModel picks the
// `subagent` route iff the tag is present, else `agent`. The tag's model
// VALUE is no longer used to route — only its presence selects the route.
//
// Both routes default to an empty route target: a partial write may omit
// either side (e.g. a save that only touches the agent route) without a
// parse error, and the .default() keeps them REQUIRED (always present) in
// the inferred output type — so composeUiConfig and the UI read
// `router[scenario].agent.primary` without a `?.` guard.
const scenarioBase = {
  agent: RouteTargetSchema.default({ primary: null, fallbacks: [] }),
  subagent: RouteTargetSchema.default({ primary: null, fallbacks: [] })
}

// A scenario with no scenario-specific parameters.
export const ScenarioRouteSchema = z.object({ ...scenarioBase }).openapi('ScenarioRoute')

// `longContext` additionally carries the token threshold above which a
// request is classified into the longContext lane.
export const LongContextScenarioRouteSchema = z
  .object({
    ...scenarioBase,
    threshold: z.number().int().positive().default(128000)
  })
  .openapi('LongContextScenarioRoute')

// --- Router (nested wire shape) ---------------------------------------------

// API wire shape returned by /api/config. One nested object per scenario,
// each holding its `agent` and `subagent` routes (primary + fallback
// chain). Scenario-scoped parameters live on the scenario that owns them
// (currently only `threshold` on longContext) so the type makes it
// impossible to set them on the wrong scenario. `persona` is a
// scenario-independent global folded in from the disk envelope's
// ActivePersona key by composeUiConfig. `image` routes are accepted for
// UI parity but are a runtime no-op (image traffic is handled by the
// image agent, not selectModel).
export const RouterSchema = z
  .object({
    default: ScenarioRouteSchema,
    background: ScenarioRouteSchema,
    think: ScenarioRouteSchema,
    longContext: LongContextScenarioRouteSchema,
    webSearch: ScenarioRouteSchema,
    image: ScenarioRouteSchema,
    persona: EmptyStringToNullSchema.optional()
  })
  .openapi('Router')
export type Router = z.infer<typeof RouterSchema>

// --- UI-side config shape ---------------------------------------------------

// UI-side Router shape consumed by the React app (config.Router). Same
// nested structure as the wire schema; adds the legacy `custom` escape
// hatch (historically allowed on per-project router files). Reuses the
// same scenario sub-schemas as RouterSchema, but is not registered with
// the OpenAPI document — it's internal to the UI.
export const RouterConfigSchema = z.object({
  default: ScenarioRouteSchema,
  background: ScenarioRouteSchema,
  think: ScenarioRouteSchema,
  longContext: LongContextScenarioRouteSchema,
  webSearch: ScenarioRouteSchema,
  image: ScenarioRouteSchema,
  persona: z.string().nonempty().optional(),
  custom: z.unknown().optional()
})
export type RouterConfig = z.infer<typeof RouterConfigSchema>

// --- Scenario key -----------------------------------------------------------

// Mirrors the Prisma ScenarioKey enum and the Router.* keys so the
// migration, configService, and UI all speak the same vocabulary.
// Derived from the SCENARIO_KEYS const tuple (kept in shared/db/types
// because it's plain data, not a Zod schema).
export const ScenarioKeySchema = z.enum(SCENARIO_KEYS)
export type ScenarioKey = z.infer<typeof ScenarioKeySchema>

// --- Runtime (flat) adapter -------------------------------------------------

// Per-kind primary map: scenario -> "provider,model" (null when unset).
export type FlatRouteMap = Record<ScenarioKey, string | null>
// Per-kind fallback map: scenario -> ordered "provider,model" chain.
export type FlatFallbackMap = Record<ScenarioKey, string[]>

// The flat Router shape the scenario-router pipeline reads at runtime
// (failover.ts, model-selection.ts, invocation.ts). Each caller kind
// (agent / subagent) gets its own primary + fallback map keyed by
// scenario, plus the longContext threshold and the persona.
// composeUiConfig emits the nested RouterSchema for the UI/API;
// context.ts flattens it here before handing it to the runtime
// ConfigStore, so the runtime read-sites stay flat and per-project
// override files (already flat) need no adapter.
export interface FlatRouter {
  agent: FlatRouteMap
  subagent: FlatRouteMap
  agentFallbacks: FlatFallbackMap
  subagentFallbacks: FlatFallbackMap
  longContextThreshold: number
  persona: string | null
}

// Flatten the nested wire Router into the runtime's flat shape. Pure —
// the sole boundary where the nested config crosses into the pipeline.
export function flattenNestedRouter(router: Router): FlatRouter {
  const persona = typeof router.persona === 'string' ? router.persona : null
  return {
    agent: {
      default: router.default.agent.primary,
      background: router.background.agent.primary,
      think: router.think.agent.primary,
      longContext: router.longContext.agent.primary,
      webSearch: router.webSearch.agent.primary,
      image: router.image.agent.primary
    },
    subagent: {
      default: router.default.subagent.primary,
      background: router.background.subagent.primary,
      think: router.think.subagent.primary,
      longContext: router.longContext.subagent.primary,
      webSearch: router.webSearch.subagent.primary,
      image: router.image.subagent.primary
    },
    agentFallbacks: {
      default: router.default.agent.fallbacks,
      background: router.background.agent.fallbacks,
      think: router.think.agent.fallbacks,
      longContext: router.longContext.agent.fallbacks,
      webSearch: router.webSearch.agent.fallbacks,
      image: router.image.agent.fallbacks
    },
    subagentFallbacks: {
      default: router.default.subagent.fallbacks,
      background: router.background.subagent.fallbacks,
      think: router.think.subagent.fallbacks,
      longContext: router.longContext.subagent.fallbacks,
      webSearch: router.webSearch.subagent.fallbacks,
      image: router.image.subagent.fallbacks
    },
    longContextThreshold: router.longContext.threshold,
    persona
  }
}
