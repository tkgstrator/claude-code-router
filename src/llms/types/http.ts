// POJO request/response types for framework-agnostic core entry points.
//
// Phase 0 of the Hono+Vite migration (see docs/server/advanced/hono-vite-migration.md):
// the public core APIs (router, agent.shouldHandle, agent.reqHandler) historically
// accepted Fastify's FastifyRequest. We now narrow them to a plain object shape so
// the same services can be invoked from any HTTP framework (Fastify today,
// Hono tomorrow). The existing Fastify request object structurally satisfies
// IncomingRequest, so the Fastify wrapper continues to work without conversion.
//
// Headers intentionally use Map<string, string> rather than Record<string, string>
// to avoid the open-ended index-signature pattern called out in project memory
// (feedback_no_record_utility). Adapters between this Map and framework-native
// header shapes live in utils/http.ts.

// Minimal logger contract every framework can satisfy. Fastify's pino logger
// implements this superset already; Hono handlers will hand in a manually
// constructed pino instance or a console-shim.
export interface RequestLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
  trace?: (...args: unknown[]) => void
  fatal?: (...args: unknown[]) => void
}

// Lightweight key/value bag for parsed URL query strings. Multi-valued keys are
// flattened to the first value by adapters since the legacy Fastify path never
// honoured array values either.
export type QueryParams = Map<string, string>

export type HttpHeaders = Map<string, string>

// Bare minimum shape every framework can populate.
export interface IncomingRequest {
  method: string
  url: string
  headers: HttpHeaders
  // body / query stay loosely-typed: the LLM payload schema is owned by
  // @anthropic-ai/sdk types, not by this interface, and downstream code
  // already narrows from `any` at use sites.
  body: unknown
  query: QueryParams
  id?: string
  log?: RequestLogger
}

// Mutable request that flows through the router / agent pipeline. The router
// rewrites `body.model`, stamps a scenarioType, and the agent layer adds
// `agents` / `preset`. Keeping these as optional fields on a single interface
// matches the existing duck-typing without forcing every caller to spread.
export interface RouterRequest extends IncomingRequest {
  body: RouterRequestBody
  sessionId?: string
  scenarioType?: string
  tokenCount?: number
  provider?: string
  model?: string | string[]
  preset?: string
  agents?: string[]
  pathname?: string
}

// The body shape the router reads/mutates. Anything not enumerated here is
// passed through untouched — UnifiedChatRequest in types/llm.ts is the
// canonical superset; this narrows to the fields the router itself touches.
export interface RouterRequestBody {
  model: string
  messages?: unknown[]
  system?: unknown
  tools?: unknown[]
  thinking?: unknown
  stream?: boolean
  metadata?: { user_id?: string }
  // Additional provider-specific fields flow through; downstream transformers
  // consume them via their own typed schemas.
  [key: string]: unknown
}

export type AgentRequest = RouterRequest
