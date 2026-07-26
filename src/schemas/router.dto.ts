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

// The fields every scenario shares, gathered in one place. The old flat
// shape scattered these across top-level slots plus sibling `fallbacks`
// and `force` objects; nesting them per scenario keeps one scenario's
// whole config together (and maps 1:1 onto a Routing Map node). `primary`
// is the "providerName,modelName" model reference or null ('' folds to
// null on parse); `fallbacks` is the ordered chain; `force` overrides the
// client's bare model with the slot model.
const scenarioBase = {
  primary: EmptyStringToNullSchema.default(null),
  fallbacks: z.array(FallbackEntrySchema).default([]),
  force: z.boolean().default(false)
}

// A scenario with no scenario-specific parameters.
export const ScenarioRouteSchema = z.object({ ...scenarioBase }).openapi('ScenarioRoute')

// `default` additionally carries the Router-wide weeklyDrainMarginPct
// policy knob: extra margin (percentage points) allowed over the weekly
// drain target before the proactive failover guard trips. It rides on
// `default` because the policy applies globally and the default slot is
// always present. 0 means the guard trips exactly at the linear target.
export const DefaultScenarioRouteSchema = z
  .object({
    ...scenarioBase,
    weeklyDrainMarginPct: z.number().int().min(0).max(100).default(0)
  })
  .openapi('DefaultScenarioRoute')

// `longContext` additionally carries the token threshold above which a
// request is classified into the longContext lane.
export const LongContextScenarioRouteSchema = z
  .object({
    ...scenarioBase,
    threshold: z.number().int().positive().default(60000)
  })
  .openapi('LongContextScenarioRoute')

// --- Router (nested wire shape) ---------------------------------------------

// API wire shape returned by /api/config. One nested object per scenario
// (each holds its own primary + fallback chain + force). Scenario-scoped
// parameters live on the scenario that owns them: `threshold` on
// longContext, `weeklyDrainMarginPct` on default — so the type makes it
// impossible to set them on the wrong scenario. `persona` is a
// scenario-independent global folded in from the disk envelope's
// ActivePersona key by composeUiConfig. `image` accepts `force` for UI
// parity, but it is a runtime no-op (image traffic is handled by the
// image agent, not selectModel).
export const RouterSchema = z
  .object({
    default: DefaultScenarioRouteSchema,
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
  default: DefaultScenarioRouteSchema,
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

// The flat Router shape the scenario-router pipeline reads at runtime
// (failover.ts, model-selection.ts, invocation.ts). It is the historical
// pre-nesting shape: per-scenario primary slots plus sibling fallbacks /
// force maps and the two scalar knobs. composeUiConfig emits the nested
// RouterSchema for the UI/API; context.ts flattens it here before handing
// it to the runtime ConfigStore, so the runtime read-sites stay unchanged
// and per-project override files (already flat) need no adapter.
export interface FlatRouter {
  default: string | null
  background: string | null
  think: string | null
  longContext: string | null
  webSearch: string | null
  image: string | null
  fallbacks: Record<ScenarioKey, string[]>
  force: Record<ScenarioKey, boolean>
  longContextThreshold: number
  weeklyDrainMarginPct: number
  persona: string | null
}

// Flatten the nested wire Router into the runtime's flat shape. Pure —
// the sole boundary where the nested config crosses into the pipeline.
export function flattenNestedRouter(router: Router): FlatRouter {
  const persona = typeof router.persona === 'string' ? router.persona : null
  return {
    default: router.default.primary,
    background: router.background.primary,
    think: router.think.primary,
    longContext: router.longContext.primary,
    webSearch: router.webSearch.primary,
    image: router.image.primary,
    fallbacks: {
      default: router.default.fallbacks,
      background: router.background.fallbacks,
      think: router.think.fallbacks,
      longContext: router.longContext.fallbacks,
      webSearch: router.webSearch.fallbacks,
      image: router.image.fallbacks
    },
    force: {
      default: router.default.force,
      background: router.background.force,
      think: router.think.force,
      longContext: router.longContext.force,
      webSearch: router.webSearch.force,
      image: router.image.force
    },
    longContextThreshold: router.longContext.threshold,
    weeklyDrainMarginPct: router.default.weeklyDrainMarginPct,
    persona
  }
}
