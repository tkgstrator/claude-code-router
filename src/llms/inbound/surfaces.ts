/**
 * Inbound surface registry.
 *
 * A "surface" is one wire format Rialto accepts on its front door. The
 * knowledge about a surface used to be spread over four places —
 * `errorShapeForPath`, `pickSseAggregator`, the bearer-auth path list in
 * `index.ts`, and `inboundTypeFromPath` — so adding a fifth surface meant
 * editing four files and hoping none was missed.
 *
 * This module is the single descriptor. Everything else derives from it.
 *
 * Note the distinction the registry makes explicit for the first time:
 * `defaultRoutingMode`. `/v1/messages` runs the full scenario → rule →
 * preference-chain → failover pipeline; the OpenAI-compat surfaces have
 * always bypassed it, because those callers hand-pick `provider,model`
 * themselves. That bypass was correct but hardcoded and invisible
 * (`scenario-router.ts`), which is why every routing screen in the old UI
 * was silently a `/v1/messages`-only screen. Here it is data, and the
 * stored per-surface override in `InboundSurfaceConfig` can change it.
 */

export type SurfaceId = 'anthropic-messages' | 'openai-chat' | 'openai-responses' | 'gemini-generate'

export type RoutingMode = 'routed' | 'passthrough'

export type InboundType = 'anthropic' | 'openai' | 'gemini'

export interface InboundSurface {
  id: SurfaceId
  /**
   * Display path. For gemini this is a glob, because the real route
   * carries the model in the path (`/v1beta/models/gemini-3-pro:generateContent`)
   * — see `matches`.
   */
  path: string
  /** The client an operator most likely points at this surface. */
  client: string
  /** Wire format persisted on Session / RequestLog. */
  inboundType: InboundType
  /** Which credential header the surface authenticates with. */
  auth: 'x-api-key' | 'bearer' | 'google'
  /** Error envelope the caller's SDK knows how to parse. */
  errorShape: 'anthropic' | 'openai' | 'google'
}

/**
 * What a surface's mode is set to when it has none yet.
 *
 * There is deliberately no per-surface default. The previous build
 * carried one — routed for /v1/messages, passthrough for the rest —
 * which reproduced a hardcoded bypass rather than expressing anything,
 * and it forced the UI to explain which of two identical-looking values
 * was "the shipped one". A surface now simply has a mode.
 *
 * Passthrough is the seed because routing an unconfigured install does
 * nothing useful: with no preference chain and no rules, the selector
 * falls straight through to the caller's own model. Routing is
 * something you turn on once there is something to route to.
 */
export const INITIAL_ROUTING_MODE: RoutingMode = 'passthrough'

export const INBOUND_SURFACES: readonly InboundSurface[] = [
  {
    id: 'anthropic-messages',
    path: '/v1/messages',
    client: 'Claude Code',
    inboundType: 'anthropic',
    auth: 'x-api-key',
    errorShape: 'anthropic'
  },
  {
    id: 'openai-chat',
    path: '/v1/chat/completions',
    client: 'OpenAI SDK',
    inboundType: 'openai',
    auth: 'bearer',
    errorShape: 'openai'
  },
  {
    id: 'openai-responses',
    path: '/v1/responses',
    client: 'Codex CLI',
    inboundType: 'openai',
    auth: 'bearer',
    errorShape: 'openai'
  },
  {
    id: 'gemini-generate',
    path: '/v1beta/models/*',
    client: 'Gemini CLI',
    inboundType: 'gemini',
    auth: 'google',
    errorShape: 'google'
  }
] as const

const BY_ID = new Map<string, InboundSurface>(INBOUND_SURFACES.map((s) => [s.id, s]))

export function surfaceById(id: string): InboundSurface | undefined {
  return BY_ID.get(id)
}

/**
 * Resolve a concrete request path to its surface.
 *
 * Exact match for the three `/v1/*` surfaces; prefix match for gemini,
 * whose model name and action live in the path itself.
 */
export function surfaceForPath(path: string | undefined): InboundSurface | undefined {
  if (typeof path !== 'string' || path.length === 0) return undefined
  const exact = INBOUND_SURFACES.find((s) => s.path === path)
  if (exact !== undefined) return exact
  if (path.startsWith('/v1beta/models/')) return BY_ID.get('gemini-generate')
  return undefined
}

/**
 * Wire-type slug persisted on RequestLog / Session.
 *
 * Returns undefined for paths that are not a routed surface (`/v1/models`
 * is a catalog read, not a completion), so those rows stay null rather
 * than being falsely bucketed.
 */
export function inboundTypeForPath(path: string | undefined): InboundType | undefined {
  return surfaceForPath(path)?.inboundType
}
