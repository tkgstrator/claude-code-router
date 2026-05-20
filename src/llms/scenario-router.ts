/**
 * Scenario-based model routing.
 *
 * Reads the inbound request and the configured `Router` map (default /
 * background / think / longContext / webSearch) and rewrites
 * `body.model` to the model the request should actually hit. The
 * scenario the router landed on is stamped onto the request so the
 * pipeline can shape its log lines (and, historically, pick a fallback
 * model — fallback was removed when we cut handleFallback).
 *
 * Port of vendor utils/router.ts, tightened to strict types: the
 * request body is now `RouterRequestBody` and the router config is
 * `RouterConfig` (mirrors AppConfig.Router from src/schemas).
 */

import { opendir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from 'pino'
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from '@/shared/constants'
import type { ConfigStore } from './registry/config'
import type { TokenizerRegistry } from './registry/tokenizer'
import type { TokenizeMessage, TokenizeRequest, TokenizeSystem, TokenizeTool } from './tokenizers/base'

export type ScenarioType = 'default' | 'background' | 'think' | 'longContext' | 'webSearch'

export interface RouterConfig {
  default?: string
  background?: string
  think?: string
  longContext?: string
  webSearch?: string
  /** Token threshold above which a request gets routed to longContext. */
  longContextThreshold?: number
}

export interface RouterRequestBody {
  model: string
  messages?: TokenizeMessage[]
  system?: TokenizeSystem
  tools?: TokenizeTool[]
  thinking?: unknown
  metadata?: { user_id?: string }
  [extra: string]: unknown
}

export interface RouterRequest {
  body: RouterRequestBody
  log: Logger
  sessionId?: string
  scenarioType?: ScenarioType
  tokenCount?: number
}

export interface RouterContext {
  config: ConfigStore
  tokenizers: TokenizerRegistry
}

interface ConfigProvider {
  name: string
  models?: string[]
}

const DEFAULT_LONG_CONTEXT_THRESHOLD = 60_000

/**
 * Mutates `req.body.model` to the selected target model and stamps
 * `req.scenarioType`. Errors fall back to `Router.default` so the
 * router never aborts the pipeline.
 */
export async function routeScenario(req: RouterRequest, ctx: RouterContext): Promise<void> {
  // metadata.user_id may carry "<user>_session_<id>" — strip the session
  // out so project-specific config can pick the matching profile.
  const userId = req.body.metadata?.user_id
  if (userId) {
    const parts = userId.split('_session_')
    if (parts.length > 1) req.sessionId = parts[1]
  }

  try {
    const tokenCount = await countRequestTokens(ctx.tokenizers, req.body)
    req.tokenCount = tokenCount

    const project = await getProjectRouter(req, ctx.config)
    const globalRouter = ctx.config.get<RouterConfig>('Router')
    const router = project ?? globalRouter

    const { model, scenarioType } = selectModel(req, tokenCount, router, ctx.config)
    req.body.model = model
    req.scenarioType = scenarioType
  } catch (err) {
    req.log.error({ err }, 'scenario router failed; falling back to default model')
    req.body.model = ctx.config.get<RouterConfig>('Router')?.default ?? req.body.model
    req.scenarioType = 'default'
  }
}

async function countRequestTokens(tokenizers: TokenizerRegistry, body: RouterRequestBody): Promise<number> {
  const tokenize: TokenizeRequest = {
    messages: Array.isArray(body.messages) ? body.messages : [],
    system: body.system,
    tools: body.tools
  }
  const result = await tokenizers.countTokens(tokenize)
  return result.tokenCount
}

function selectModel(
  req: RouterRequest,
  tokenCount: number,
  router: RouterConfig | undefined,
  config: ConfigStore
): { model: string; scenarioType: ScenarioType } {
  // Explicit "provider,model" override — short-circuit, no scenario routing.
  if (req.body.model.includes(',')) {
    const [providerInput, modelInput] = req.body.model.split(',')
    const providers = config.get<ConfigProvider[]>('providers', [])
    const provider = providers.find((p) => p.name.toLowerCase() === providerInput.toLowerCase())
    const model = provider?.models?.find((m) => m.toLowerCase() === modelInput.toLowerCase())
    if (provider && model) return { model: `${provider.name},${model}`, scenarioType: 'default' }
    return { model: req.body.model, scenarioType: 'default' }
  }

  // Long context — token count exceeds threshold AND Router.longContext set.
  const threshold = router?.longContextThreshold ?? DEFAULT_LONG_CONTEXT_THRESHOLD
  if (tokenCount > threshold && router?.longContext) {
    req.log.info(`Using long context model due to token count: ${tokenCount}, threshold: ${threshold}`)
    return { model: router.longContext, scenarioType: 'longContext' }
  }

  // <CCR-SUBAGENT-MODEL> tag in the second system block — explicit
  // per-call model override Claude Code's subagent flow uses.
  const subagentModel = extractSubagentModel(req.body.system)
  if (subagentModel) return { model: subagentModel, scenarioType: 'default' }

  // Any Claude Haiku variant → background model.
  if (
    typeof req.body.model === 'string' &&
    req.body.model.includes('claude') &&
    req.body.model.includes('haiku') &&
    router?.background
  ) {
    req.log.info(`Using background model for ${req.body.model}`)
    return { model: router.background, scenarioType: 'background' }
  }

  // Web search tools — higher priority than `thinking`. body.tools may
  // carry vendor-specific shapes (Anthropic's `{ type: 'web_search_*' }`
  // block) that TokenizeTool doesn't model; narrow `type` via unknown.
  if (Array.isArray(req.body.tools) && router?.webSearch) {
    const hasWebSearch = req.body.tools.some((tool: unknown) => {
      const type = (tool as { type?: unknown }).type
      return typeof type === 'string' && type.startsWith('web_search')
    })
    if (hasWebSearch) return { model: router.webSearch, scenarioType: 'webSearch' }
  }

  // `thinking` field present → think model.
  if (req.body.thinking && router?.think) {
    req.log.info({ thinking: req.body.thinking }, 'Using think model')
    return { model: router.think, scenarioType: 'think' }
  }

  return { model: router?.default ?? req.body.model, scenarioType: 'default' }
}

function extractSubagentModel(system: TokenizeSystem | undefined): string | undefined {
  if (!Array.isArray(system) || system.length < 2) return undefined
  const block = system[1]
  const text = typeof block?.text === 'string' ? block.text : undefined
  if (!text || !text.startsWith('<CCR-SUBAGENT-MODEL>')) return undefined
  const match = text.match(/<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s)
  if (!match) return undefined
  // Strip the tag so it doesn't reach the upstream provider.
  block.text = text.replace(`<CCR-SUBAGENT-MODEL>${match[1]}</CCR-SUBAGENT-MODEL>`, '')
  return match[1]
}

// ─── Project-specific router override ──────────────────────────────────

interface ProjectRouterConfig {
  Router?: RouterConfig
}

async function getProjectRouter(req: RouterRequest, _config: ConfigStore): Promise<RouterConfig | undefined> {
  if (!req.sessionId) return undefined
  const project = await searchProjectBySession(req.sessionId)
  if (!project) return undefined

  // Per-session override wins over per-project override.
  const sessionPath = join(HOME_DIR, project, `${req.sessionId}.json`)
  const projectPath = join(HOME_DIR, project, 'config.json')
  for (const path of [sessionPath, projectPath]) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as ProjectRouterConfig
      if (parsed?.Router) return parsed.Router
    } catch {
      // Either missing file or bad JSON; try the next candidate.
    }
  }
  return undefined
}

const sessionProjectCache = new Map<string, string | null>()

async function searchProjectBySession(sessionId: string): Promise<string | null> {
  const cached = sessionProjectCache.get(sessionId)
  if (cached !== undefined) return cached

  try {
    const dir = await opendir(CLAUDE_PROJECTS_DIR)
    const folderNames: string[] = []
    for await (const dirent of dir) {
      if (dirent.isDirectory()) folderNames.push(dirent.name)
    }

    const checks = await Promise.all(
      folderNames.map(async (folder) => {
        try {
          const filePath = join(CLAUDE_PROJECTS_DIR, folder, `${sessionId}.jsonl`)
          const s = await stat(filePath)
          return s.isFile() ? folder : null
        } catch {
          return null
        }
      })
    )

    for (const r of checks) {
      if (r) {
        sessionProjectCache.set(sessionId, r)
        return r
      }
    }
    sessionProjectCache.set(sessionId, null)
    return null
  } catch {
    sessionProjectCache.set(sessionId, null)
    return null
  }
}
