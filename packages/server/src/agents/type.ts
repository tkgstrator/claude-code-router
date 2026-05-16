import type { AgentRequest } from '@musistudio/llms'

// Backwards-compat alias: agent code historically referred to the request
// argument as `req`. The POJO AgentRequest (see core/src/types/http.ts) is the
// canonical shape Phase 0 of the Hono migration is converging on. The legacy
// FastifyRequest passed by packages/server/src/index.ts structurally satisfies
// it, so existing call sites keep working without conversion.
export type IAgentRequest = AgentRequest

// The config object handed to agents is the loaded AppConfig from
// loadFullConfig(). Its full shape is intentionally unconstrained today
// (`AppConfig` in core is `[key: string]: any`); narrowing it is out of scope
// for Phase 0, which targets the request side. Kept as `any` so existing
// handlers (which probe arbitrary Router/PORT/APIKEY fields) compile against
// the new IAgent contract without churn.
// biome-ignore lint/suspicious/noExplicitAny: AppConfig schema is owned by core; tightening is a separate PR.
export type IAgentConfig = any

export interface ITool {
  name: string
  description: string
  input_schema: any

  // Tool handlers receive the parsed args plus an opaque context (req + config).
  handler: (args: any, context: { req: IAgentRequest; config: IAgentConfig }) => Promise<string>
}

export interface IAgent {
  name: string

  tools: Map<string, ITool>

  shouldHandle: (req: IAgentRequest, config: IAgentConfig) => boolean

  reqHandler: (req: IAgentRequest, config: IAgentConfig) => void

  resHandler?: (payload: any, config: IAgentConfig) => void
}
