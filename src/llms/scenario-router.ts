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
import {
  type Persona,
  ProjectRouterFileSchema,
  type Router,
  type ScenarioRouterConfig as RouterConfig,
  type ScenarioType
} from '@/schemas'
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from '@/shared/constants'
import { isProviderExhausted, markProviderExhausted } from '../services/failover-state'
import { getKindHeadroom } from '../services/usage-service'
import type { ConfigStore } from './registry/config'
import type { TokenizerRegistry } from './registry/tokenizer'
import type { TokenizeMessage, TokenizeRequest, TokenizeSystem, TokenizeTool } from './tokenizers/base'

export type { ScenarioRouterConfig as RouterConfig, ScenarioType } from '@/schemas'

export type RouterRequestBody = {
  model: string
  messages?: TokenizeMessage[]
  system?: TokenizeSystem
  tools?: TokenizeTool[]
  thinking?: unknown
  metadata?: { user_id?: string }
  [extra: string]: unknown
}

export type RouterRequest = {
  body: RouterRequestBody
  log: Logger
  sessionId?: string
  scenarioType?: ScenarioType
  tokenCount?: number
}

export type RouterContext = {
  config: ConfigStore
  tokenizers: TokenizerRegistry
}

type ConfigProvider = {
  name: string
  models?: string[]
  api_base_url?: string
  auth_mode?: string
}

const DEFAULT_LONG_CONTEXT_THRESHOLD = 60_000

// Map a provider name to the subscription usage "kind" whose limit we can
// pre-empt, or null for api_key / non-subscription providers (they have
// no usage ceiling to read; their limits are handled reactively on 429).
// Mirrors the apiBaseUrl matching in subscription-account-sync-service.
function subscriptionKindOf(providerName: string, providers: ConfigProvider[]): 'claude' | 'codex' | null {
  const p = providers.find((x) => x.name === providerName)
  if (p?.auth_mode !== 'subscription') return null
  const url = typeof p.api_base_url === 'string' ? p.api_base_url : ''
  if (url.includes('anthropic.com')) return 'claude'
  if (url.includes('chatgpt.com') || url.includes('openai.com/v1')) return 'codex'
  return null
}

// Whether a single chain candidate is usable right now. A subscription
// provider that is already exhausted, or whose cached usage is at/over
// the threshold, is not usable — and an over-threshold one is marked
// exhausted here so the reactive path and later requests agree until its
// window resets. Non-subscription providers are always usable (no usage
// ceiling to read; their limits are handled reactively on 429).
function candidateUsable(providerName: string, providers: ConfigProvider[]): boolean {
  if (isProviderExhausted(providerName)) return false
  const kind = subscriptionKindOf(providerName, providers)
  if (kind === null) return true
  const headroom = getKindHeadroom(kind)
  if (!headroom.overLimit) return true
  markProviderExhausted(providerName, headroom.resetAt !== null ? headroom.resetAt : undefined)
  return false
}

/**
 * Proactive failover: before sending, walk [primary, ...fallbacks] for
 * the scenario and return the first candidate whose provider has
 * headroom. When every candidate looks limited we keep the primary and
 * let the upstream / reactive 429 path take over.
 */
function applyProactiveFailover(
  primaryModel: string,
  scenarioType: ScenarioType,
  config: ConfigStore,
  log: Logger
): string {
  const fullRouter = config.get<Router>('Router')
  const configured = fullRouter?.fallbacks?.[scenarioType]
  if (!Array.isArray(configured) || configured.length === 0) return primaryModel

  const providers = config.get<ConfigProvider[]>('providers', [])
  for (const candidate of [primaryModel, ...configured]) {
    const providerName = candidate.split(',')[0]
    if (!providerName || !candidateUsable(providerName, providers)) continue
    if (candidate !== primaryModel) {
      log.info(
        { from: primaryModel, to: candidate, scenario: scenarioType },
        'proactive failover: primary near rate limit'
      )
    }
    return candidate
  }

  return primaryModel
}

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
    // Project-level override wins; fall through to the global Router map
    // when no per-project file applies.
    const router: RouterConfig | undefined = project !== undefined ? project : globalRouter

    const { model, scenarioType } = selectModel(req, tokenCount, router, ctx.config)
    req.body.model = applyProactiveFailover(model, scenarioType, ctx.config, req.log)
    req.scenarioType = scenarioType

    // Append the active persona's prompt to user-facing routes only,
    // AFTER subagent-tag handling (done inside selectModel) so it
    // composes with — rather than clobbers — any per-call system content.
    // The `background` route runs lightweight internal tasks (e.g. title
    // generation) where a persona voice would corrupt the output, so it is
    // excluded. Empty is a no-op, keeping the cached prefix byte-stable.
    const personaPrompt = scenarioType === 'background' ? '' : resolveActivePersonaPrompt(ctx.config)
    req.body.system = applyGlobalSystemPrompt(req.body.system, personaPrompt)
  } catch (err) {
    req.log.error({ err }, 'scenario router failed; falling back to default model')
    const fallback = ctx.config.get<RouterConfig>('Router')?.default
    if (fallback) req.body.model = fallback
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
    return resolveExplicitProviderModel(req.body.model, config)
  }

  // Long context — token count exceeds threshold AND Router.longContext set.
  if (router) {
    const longContext = pickLongContext(req, tokenCount, router)
    if (longContext) return longContext
  }

  // <CCR-SUBAGENT-MODEL> tag in the second system block — explicit
  // per-call model override Claude Code's subagent flow uses.
  const subagentModel = extractSubagentModel(req.body.system)
  if (subagentModel) return { model: subagentModel, scenarioType: 'default' }

  // Any Claude Haiku variant → background model.
  if (isHaikuBackground(req.body.model, router)) {
    req.log.info(`Using background model for ${req.body.model}`)
    return { model: router.background, scenarioType: 'background' }
  }

  // Web search tools — higher priority than `thinking`. body.tools may
  // carry vendor-specific shapes (Anthropic's `{ type: 'web_search_*' }`
  // block) that TokenizeTool doesn't model.
  if (router?.webSearch && Array.isArray(req.body.tools) && req.body.tools.some(isWebSearchTool)) {
    return { model: router.webSearch, scenarioType: 'webSearch' }
  }

  // `thinking` field present → think model.
  if (req.body.thinking && router?.think) {
    req.log.info({ thinking: req.body.thinking }, 'Using think model')
    return { model: router.think, scenarioType: 'think' }
  }

  const fallback = router?.default
  return { model: fallback ? fallback : req.body.model, scenarioType: 'default' }
}

function resolveExplicitProviderModel(
  rawModel: string,
  config: ConfigStore
): { model: string; scenarioType: ScenarioType } {
  const [providerInput, modelInput] = rawModel.split(',')
  const providers = config.get<ConfigProvider[]>('providers', [])
  const provider = providers.find((p) => p.name.toLowerCase() === providerInput.toLowerCase())
  const model = provider?.models?.find((m) => m.toLowerCase() === modelInput.toLowerCase())
  if (provider && model) return { model: `${provider.name},${model}`, scenarioType: 'default' }
  return { model: rawModel, scenarioType: 'default' }
}

function pickLongContext(
  req: RouterRequest,
  tokenCount: number,
  router: RouterConfig
): { model: string; scenarioType: ScenarioType } | undefined {
  const threshold =
    typeof router.longContextThreshold === 'number' ? router.longContextThreshold : DEFAULT_LONG_CONTEXT_THRESHOLD
  if (tokenCount > threshold && router.longContext) {
    req.log.info(`Using long context model due to token count: ${tokenCount}, threshold: ${threshold}`)
    return { model: router.longContext, scenarioType: 'longContext' }
  }
  return undefined
}

function isHaikuBackground(
  model: string,
  router: RouterConfig | undefined
): router is RouterConfig & { background: string } {
  return (
    typeof model === 'string' &&
    model.includes('claude') &&
    model.includes('haiku') &&
    typeof router?.background === 'string' &&
    router.background.length > 0
  )
}

function isWebSearchTool(tool: unknown): tool is { type: string } {
  if (tool === null || typeof tool !== 'object' || !('type' in tool)) return false
  const type: unknown = Reflect.get(tool, 'type')
  return typeof type === 'string' && type.startsWith('web_search')
}

// Whether a system block carries a truthy `cache_control` discriminator.
// TokenizeSystemBlock doesn't model `cache_control` (the tokenizer
// ignores it), so we probe the runtime value instead of casting.
function hasCacheControl(block: unknown): boolean {
  if (block === null || typeof block !== 'object' || !('cache_control' in block)) return false
  const cacheControl: unknown = Reflect.get(block, 'cache_control')
  return cacheControl !== null && cacheControl !== undefined
}

// Read a block's `text` only when it's a plain string (Anthropic also
// allows string[] per TokenizeSystemBlock — we append solely to string
// blocks so the cached prefix stays a single coherent text).
function stringTextOf(block: unknown): string | undefined {
  if (block === null || typeof block !== 'object' || !('text' in block)) return undefined
  const text: unknown = Reflect.get(block, 'text')
  return typeof text === 'string' ? text : undefined
}

/**
 * Resolve the active persona's prompt text from the config store.
 *
 * Reads the `ActivePersona` name and the `Personas` library, returns the
 * matching persona's `prompt`. Returns '' when no persona is active, the
 * name matches nothing, or the prompt is empty — applyGlobalSystemPrompt
 * treats '' as a no-op so the cached prefix stays byte-stable.
 */
function resolveActivePersonaPrompt(config: ConfigStore): string {
  // composeUiConfig emits ActivePersona as string | null, so a present
  // key may legitimately hold null — guard the type rather than assert.
  const activeName = config.get<string | null>('ActivePersona', null)
  if (typeof activeName !== 'string' || activeName.length === 0) return ''
  const personas = config.get<Persona[]>('Personas', [])
  const match = personas.find((p) => p.name === activeName)
  return match !== undefined ? match.prompt : ''
}

/**
 * Append the global persona to the request's `system` cache-safely.
 *
 * The persona is appended to the LAST system block carrying
 * `cache_control` (falling back to the last string text block) so it
 * stays INSIDE the cached prefix and consumes no extra cache breakpoint.
 * The append is deterministic — same prompt yields the same bytes every
 * request — which is what preserves Anthropic's prompt cache.
 *
 * Array blocks are mutated in place (matching extractSubagentModel);
 * string / undefined system values can't be mutated in place, so the
 * new value is returned and the caller assigns it back.
 */
function applyGlobalSystemPrompt(system: TokenizeSystem | undefined, prompt: string): TokenizeSystem | undefined {
  if (prompt.trim().length === 0) return system

  if (system === undefined) return prompt

  if (typeof system === 'string') return `${system}\n\n${prompt}`

  if (system.length === 0) return prompt

  // Prefer the last cache_control-bearing block so the persona lands
  // inside the cached prefix; otherwise fall back to the last string
  // text block.
  const withCacheText = system.filter((block) => hasCacheControl(block) && stringTextOf(block) !== undefined)
  const withText = system.filter((block) => stringTextOf(block) !== undefined)
  const target = withCacheText.length > 0 ? withCacheText[withCacheText.length - 1] : withText[withText.length - 1]
  if (target === undefined) return system

  const current = stringTextOf(target)
  if (current === undefined) return system
  target.text = `${current}\n\n${prompt}`
  return system
}

function extractSubagentModel(system: TokenizeSystem | undefined): string | undefined {
  if (!Array.isArray(system) || system.length < 2) return undefined
  const block = system[1]
  const text = typeof block?.text === 'string' ? block.text : undefined
  if (!text?.startsWith('<CCR-SUBAGENT-MODEL>')) return undefined
  const match = text.match(/<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s)
  if (!match) return undefined
  // Strip the tag so it doesn't reach the upstream provider.
  block.text = text.replace(`<CCR-SUBAGENT-MODEL>${match[1]}</CCR-SUBAGENT-MODEL>`, '')
  return match[1]
}

// ─── Project-specific router override ──────────────────────────────────

async function getProjectRouter(req: RouterRequest, _config: ConfigStore): Promise<RouterConfig | undefined> {
  if (!req.sessionId) return undefined
  const project = await searchProjectBySession(req.sessionId)
  if (!project) return undefined

  // Per-session override wins over per-project override. Both files are
  // optional — missing files / bad JSON / unknown shape silently fall
  // through to the next candidate (no HTTPException here because the
  // global Router is the always-available fallback).
  const sessionPath = join(HOME_DIR, project, `${req.sessionId}.json`)
  const projectPath = join(HOME_DIR, project, 'config.json')
  for (const path of [sessionPath, projectPath]) {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      req.log.warn({ path }, 'Project router file is not valid JSON; skipping')
      continue
    }
    const result = ProjectRouterFileSchema.safeParse(raw)
    if (!result.success) {
      req.log.warn(
        { path, err: JSON.stringify(result.error.issues) },
        'Project router file does not match schema; skipping'
      )
      continue
    }
    if (result.data.Router) return result.data.Router
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
