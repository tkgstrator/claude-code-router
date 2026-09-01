/**
 * How a request is routed: the scenario routes, their rule stacks and
 * the flat shape the pipeline reads at request time.
 *
 * Domain rather than api even though these schemas are registered as
 * OpenAPI components — see the note in ./index.ts on why registration
 * could not be confined to the api layer.
 */

import { z } from '@hono/zod-openapi'
import { EmptyStringToNullSchema } from '@/schemas/primitives/common'
import { SCENARIO_KEYS } from '@/shared/db/types'

// --- Scenario route (nested) ------------------------------------------------

// A fallback-chain entry: a non-empty "providerName,modelName" string.
// Order is meaningful — the router walks the list in sequence when the
// primary is rate-limited (proactively on a high usage percentage, or
// reactively on a 429). Same-provider-as-primary entries are rejected
// downstream (applyRouter / the UI option filter), not here.
const FallbackEntrySchema = z.string().nonempty()

// The four families of Claude models CC (and everything upstream of
// Rialto that speaks the Anthropic wire format) actually sends: fable,
// opus, sonnet, haiku. The tier is derived from the requested model
// name with case-insensitive substring matching, so `claude-opus-4-7`
// tiers to `opus` regardless of version suffix. This is the vocabulary
// the UI's rule editor should expose — the underlying string match
// is an implementation detail.
export const REQUESTED_MODEL_TIERS = ['fable', 'opus', 'sonnet', 'haiku'] as const
export type RequestedModelTier = (typeof REQUESTED_MODEL_TIERS)[number]

// The five effort levels Claude Code sends on `output_config.effort`.
// The router already reads this internally to grade "heavy" work
// (`isHeavyRequest`); the rule predicate lets a rule fire on the same
// signal explicitly (e.g. "route xhigh/max effort to Fable").
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type RuleEffortLevel = (typeof EFFORT_LEVELS)[number]

// Predicate for a routing rule. Empty object = always match (the
// "catch-all" rule at the bottom of a rule stack); any populated field
// narrows the match. All fields AND together — a rule with both
// `requestedTier` and `thinking` set matches only when both hold.
// Extending this object stays backward-compatible because omitted
// fields simply don't constrain.
//
// - `requestedTier`: matches when the request's model tiers into one
//   of the listed families (fable / opus / sonnet / haiku). The
//   4-choice enum is what the UI editor presents; a rule with three
//   tiers ticked is a NOT-IN of the remaining tier.
// - `requestedModel`: shell-style glob against the client's
//   body.model (advanced / legacy escape hatch). Anchored on both
//   ends — `*haiku*` matches "claude-haiku-4-5", plain `haiku` does
//   not. Not surfaced in the UI; kept so the boot migration and
//   power users can still write exact-match rules.
// - `thinking`: matches when `body.thinking` is truthy (true) or
//   absent/falsy (false). Anthropic's thinking field is either
//   `undefined` or an object; the check normalises to boolean.
// - `minTokens` / `maxTokens`: inclusive bounds against the
//   pre-classification token count (the same count the size-based
//   longContext branch uses). Combines with `thinking` to hit
//   "thinking-in-long-context" without adding a scenario.
// - `hasTool`: shell-style glob against any tool's `type` field in
//   `body.tools`. Useful for "if this request carries a
//   web_search_* tool → route here".
// - `effort`: matches when `body.output_config.effort` is one of the
//   listed levels. Multi-select IN — ticking `['high','xhigh','max']`
//   catches "heavy work" without having to add three rules. Requests
//   without an effort field (older CC traffic) never match.
export const RulePredicateSchema = z
  .object({
    requestedTier: z.array(z.enum(REQUESTED_MODEL_TIERS)).nonempty().optional(),
    requestedModel: z.string().nonempty().optional(),
    thinking: z.boolean().optional(),
    minTokens: z.number().int().nonnegative().optional(),
    maxTokens: z.number().int().nonnegative().optional(),
    hasTool: z.string().nonempty().optional(),
    effort: z.array(z.enum(EFFORT_LEVELS)).nonempty().optional()
  })
  .openapi('RulePredicate')

// A single routing rule: a predicate over the incoming request plus
// the model to reroute to when the predicate matches. `name` is a
// UI-only label (dropped from the editor but preserved in the schema
// so the boot migration + existing configs round-trip unchanged).
// Rules are evaluated in the order they appear in the enclosing route
// target; first match wins. If no rule matches (or a route target
// carries no rules), the target's top-level `primary` + `fallbacks`
// act as the catch-all. When a rule DOES match, its `target` becomes
// the primary and the failover chain cascades through the scenario's
// catch-all: rule target → scenario primary → scenario fallbacks. So
// a rule that reroutes Opus|Fable to Fable can still fall over to the
// scenario primary (e.g. Opus5) and then to the scenario fallbacks
// (e.g. Terra) once Fable is rate-limited. Rules therefore never carry
// their own fallback list.
export const RouteRuleSchema = z
  .object({
    name: z.string().optional(),
    when: RulePredicateSchema.default({}),
    target: EmptyStringToNullSchema.default(null)
  })
  .openapi('RouteRule')

// A single route target: the catch-all primary + fallback chain, plus an
// optional ordered list of `rules` that override the catch-all when their
// predicate matches. `primary` is the "providerName,modelName" reference
// or null ('' folds to null on parse); `fallbacks` is the failover chain
// the runtime walks when the primary is rate-limited. Every scenario
// carries two of these — one per caller kind (agent / subagent).
export const RouteTargetSchema = z
  .object({
    primary: EmptyStringToNullSchema.default(null),
    fallbacks: z.array(FallbackEntrySchema).default([]),
    rules: z.array(RouteRuleSchema).default([])
  })
  .openapi('RouteTarget')

// The fields every scenario shares: TWO routes keyed by caller kind.
// `agent` handles normal / main-agent traffic; `subagent` handles a
// request carrying a <RIALTO-SUBAGENT-MODEL> tag. selectModel picks the
// `subagent` route iff the tag is present, else `agent`. The tag's model
// VALUE is no longer used to route — only its presence selects the route.
//
// Both routes default to an empty route target: a partial write may omit
// either side (e.g. a save that only touches the agent route) without a
// parse error, and the .default() keeps them REQUIRED (always present) in
// the inferred output type — so composeUiConfig and the UI read
// `router[scenario].agent.primary` without a `?.` guard.
const scenarioBase = {
  agent: RouteTargetSchema.default({ primary: null, fallbacks: [], rules: [] }),
  subagent: RouteTargetSchema.default({ primary: null, fallbacks: [], rules: [] })
}

// A scenario with no scenario-specific parameters.
export const ScenarioRouteSchema = z.object({ ...scenarioBase }).openapi('ScenarioRoute')

// `longContext` additionally carries the token threshold above which a
// request is classified into the longContext lane. `null` means "auto":
// the runtime computes an effective threshold from the default agent
// primary's contextWindow (× LONG_CONTEXT_AUTO_RATIO) so it tracks the
// selected default model automatically. A number pins the threshold
// manually, which the auto path falls back to when no contextWindow is
// available.
export const LongContextScenarioRouteSchema = z
  .object({
    ...scenarioBase,
    threshold: z.number().int().positive().nullable().default(null)
  })
  .openapi('LongContextScenarioRoute')

// --- Router (nested wire shape) ---------------------------------------------

// API wire shape returned by /api/config. One nested object per scenario,
// each holding its `agent` and `subagent` routes (primary + fallback
// chain + rules). Scenario-scoped parameters live on the scenario that
// owns them (currently only `threshold` on longContext) so the type
// makes it impossible to set them on the wrong scenario. `persona` is a
// scenario-independent global folded in from the disk envelope's
// ActivePersona key by composeUiConfig. `image` routes are accepted for
// UI parity but are a runtime no-op (image traffic is handled by the
// image agent, not selectModel). The former `background` scenario was
// folded into a rule on `default.agent.rules` / `default.subagent.rules`
// (predicate: requestedModel matches a haiku glob) and no longer appears
// here as its own top-level key.
export const RouterSchema = z
  .object({
    default: ScenarioRouteSchema,
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
  think: ScenarioRouteSchema,
  longContext: LongContextScenarioRouteSchema,
  webSearch: ScenarioRouteSchema,
  image: ScenarioRouteSchema,
  // Nullable, not just optional: composeUiConfig emits `persona: null`
  // when nothing is active, and the UI sends null back to clear it.
  // Typing this as `string | undefined` is what pushed Personas.tsx into
  // sending `undefined`, which JSON.stringify strips.
  persona: z.string().nonempty().nullable().optional(),
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
//
// `longContextThreshold` is `null` when the operator picked "auto":
// model-selection.ts derives the effective value from
// `defaultAgentContextWindow` (× LONG_CONTEXT_AUTO_RATIO) so it tracks
// the selected default model. `defaultAgentContextWindow` is populated
// by the sole caller that has cfg.Providers available (context.ts);
// per-project override files leave it null and inherit the manual
// fallback (128k) whenever auto also can't resolve.
export interface FlatRouter {
  agent: FlatRouteMap
  subagent: FlatRouteMap
  agentFallbacks: FlatFallbackMap
  subagentFallbacks: FlatFallbackMap
  agentRules: FlatRulesMap
  subagentRules: FlatRulesMap
  longContextThreshold: number | null
  defaultAgentContextWindow: number | null
  persona: string | null
}

// Per-kind rules map: scenario -> ordered rule list. Runtime consults
// these first (via evaluateRoute); when no rule matches, the flat
// primary/fallback maps above serve as the catch-all.
export type FlatRulesMap = Record<ScenarioKey, RouteRule[]>
export type RouteRule = z.infer<typeof RouteRuleSchema>

// Flatten the nested wire Router into the runtime's flat shape. Pure —
// the sole boundary where the nested config crosses into the pipeline.
// `opts.defaultAgentContextWindow` is a caller-resolved capacity of the
// default agent primary (context.ts looks it up in cfg.Providers); when
// absent it stays null and the runtime auto-threshold path falls back
// to the manual 128k constant.
export function flattenNestedRouter(router: Router, opts?: { defaultAgentContextWindow?: number | null }): FlatRouter {
  const persona = typeof router.persona === 'string' ? router.persona : null
  const defaultAgentContextWindow =
    typeof opts?.defaultAgentContextWindow === 'number' && opts.defaultAgentContextWindow > 0
      ? opts.defaultAgentContextWindow
      : null
  return {
    agent: {
      default: router.default.agent.primary,
      think: router.think.agent.primary,
      longContext: router.longContext.agent.primary,
      webSearch: router.webSearch.agent.primary,
      image: router.image.agent.primary
    },
    subagent: {
      default: router.default.subagent.primary,
      think: router.think.subagent.primary,
      longContext: router.longContext.subagent.primary,
      webSearch: router.webSearch.subagent.primary,
      image: router.image.subagent.primary
    },
    agentFallbacks: {
      default: router.default.agent.fallbacks,
      think: router.think.agent.fallbacks,
      longContext: router.longContext.agent.fallbacks,
      webSearch: router.webSearch.agent.fallbacks,
      image: router.image.agent.fallbacks
    },
    subagentFallbacks: {
      default: router.default.subagent.fallbacks,
      think: router.think.subagent.fallbacks,
      longContext: router.longContext.subagent.fallbacks,
      webSearch: router.webSearch.subagent.fallbacks,
      image: router.image.subagent.fallbacks
    },
    agentRules: {
      default: router.default.agent.rules,
      think: router.think.agent.rules,
      longContext: router.longContext.agent.rules,
      webSearch: router.webSearch.agent.rules,
      image: router.image.agent.rules
    },
    subagentRules: {
      default: router.default.subagent.rules,
      think: router.think.subagent.rules,
      longContext: router.longContext.subagent.rules,
      webSearch: router.webSearch.subagent.rules,
      image: router.image.subagent.rules
    },
    longContextThreshold: router.longContext.threshold,
    defaultAgentContextWindow,
    persona
  }
}
