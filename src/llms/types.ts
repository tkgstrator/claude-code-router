/**
 * Domain types for the LLM proxy pipeline.
 *
 * Ported from the legacy vendor/llms package and trimmed to the surface
 * the supported transformers (anthropic / openai / openai-responses /
 * gemini / claude-code-oauth / codex-oauth) actually touch. Everything
 * here is strict TS; no `any` index signatures.
 */

import type {
  MessageParam as AnthropicMessage,
  Message as AnthropicMessageResponse,
  Tool as AnthropicTool,
  MessageStreamEvent
} from '@anthropic-ai/sdk/resources/messages'
import type {
  ChatCompletionChunk,
  ChatCompletionTool,
  ChatCompletionMessageParam as OpenAIMessage
} from 'openai/resources/chat/completions'

// ─── Content / Message ──────────────────────────────────────────────────

export interface UrlCitation {
  url: string
  title: string
  content: string
  start_index: number
  end_index: number
}

export interface Annotation {
  type: 'url_citation'
  url_citation?: UrlCitation
}

export interface TextContent {
  type: 'text'
  text: string
  cache_control?: { type?: string }
}

export interface ImageContent {
  type: 'image_url'
  image_url: { url: string }
  media_type: string
}

export type MessageContent = TextContent | ImageContent

export interface UnifiedToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null | MessageContent[]
  tool_calls?: UnifiedToolCall[]
  tool_call_id?: string
  cache_control?: { type?: string }
  thinking?: { content: string; signature?: string }
}

export interface UnifiedTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
      additionalProperties?: boolean
      $schema?: string
    }
  }
}

export type ThinkLevel = 'none' | 'low' | 'medium' | 'high'

export interface UnifiedChatRequest {
  messages: UnifiedMessage[]
  model: string
  max_tokens?: number
  temperature?: number
  stream?: boolean
  tools?: UnifiedTool[]
  tool_choice?: 'auto' | 'none' | 'required' | string | { type: 'function'; function: { name: string } }
  reasoning?: {
    effort?: ThinkLevel
    max_tokens?: number
    enabled?: boolean
  }
}

export interface UnifiedChatResponse {
  id: string
  model: string
  content: string | null
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  tool_calls?: UnifiedToolCall[]
  annotations?: Annotation[]
}

// ─── Streaming ──────────────────────────────────────────────────────────

export type AnthropicStreamEvent = MessageStreamEvent
export type OpenAIStreamChunk = ChatCompletionChunk

export interface StreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices?: Array<{
    index: number
    delta: {
      role?: string
      content?: string
      thinking?: { content?: string; signature?: string }
      tool_calls?: Array<{
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
      annotations?: Annotation[]
    }
    finish_reason?: string | null
  }>
}

// ─── Vendor-specific request shapes (used by transformers) ──────────────

export interface OpenAIChatRequest {
  messages: OpenAIMessage[]
  model: string
  max_tokens?: number
  temperature?: number
  stream?: boolean
  tools?: ChatCompletionTool[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

export interface AnthropicChatRequest {
  messages: AnthropicMessage[]
  model: string
  max_tokens: number
  temperature?: number
  stream?: boolean
  system?: string
  tools?: AnthropicTool[]
  tool_choice?: { type: 'auto' } | { type: 'tool'; name: string }
}

export type AnthropicResponse = AnthropicMessageResponse

// ─── Provider / Pipeline context ────────────────────────────────────────

/**
 * Runtime provider shape consumed by the pipeline AND by transformer
 * hooks. Mirrors the snake_case config that `loadFullConfig` returns
 * (kept that way to avoid touching dozens of upstream transformer
 * files), plus the runtime-only fields the subscription overlay
 * populates.
 *
 * `transformer.use` is intentionally typed `unknown[]` here: the
 * pipeline mutates it into an array of Transformer instances after the
 * registry resolves names, but the transformer hooks themselves never
 * iterate it (they only read sibling fields like
 * `subscriptionCredentialPath` / `subscriptionAuth`). Keeping the
 * declaration loose avoids a circular import between types.ts and
 * transformers/base.ts.
 */
export interface RuntimeProvider {
  name: string
  api_base_url: string
  api_key: string
  models: string[]
  transformer?: ProviderTransformerConfig
}

export interface ProviderTransformerConfig {
  /** Top-level transformer chain (provider-wide). Loose by design — see
   *  the RuntimeProvider doc-comment for why. */
  use?: unknown[]
  /** Per-model overrides plus runtime-injected fields
   *  (subscriptionCredentialPath, subscriptionAuth). */
  [modelOrKey: string]: unknown
}

export interface ProviderModelTransformerConfig {
  use?: unknown[]
}

/** Each `use` entry on the CONFIG side is either a transformer NAME or
 *  `[name, opts]`. Producers (the registry) translate this into runtime
 *  Transformer instances. Used by the registry only — the pipeline and
 *  hooks see resolved instances. */
export type TransformerUseEntry = string | [string, Record<string, unknown>]

/** Shape the ProviderRegistry consumes when registering providers from
 *  the AppConfig.Providers slice. Identical to RuntimeProvider but with
 *  the use entries narrowed to the typed config form. */
export interface ProviderConfigShape extends Omit<RuntimeProvider, 'transformer'> {
  transformer?: {
    use?: TransformerUseEntry[]
    [modelOrKey: string]: unknown
  }
}

// ─── Transformer hook context ───────────────────────────────────────────

export interface TransformerContext {
  req?: PipelineRequest
  [extra: string]: unknown
}

export interface PipelineRequest {
  headers: Record<string, string>
  body: Record<string, unknown>
  url: string
  provider?: string
  model?: string
  scenarioType?: string
  sessionId?: string
  tokenCount?: number
}

export interface TransformerHookResult {
  body?: unknown
  config?: TransformerConfig
}

export interface TransformerConfig {
  url?: URL | string
  headers?: Record<string, string | undefined>
}

/** Shape returned by Transformer.auth() in bypass mode. Same shape as
 * TransformerHookResult; kept as a distinct alias so consumers can read
 * the call site as "this is auth" vs "this is a transform hook". */
export type TransformerAuthResult = TransformerHookResult

// ─── Tokenizer ─────────────────────────────────────────────────────────

export interface ProviderTokenizerConfig {
  type?: 'tiktoken' | 'huggingface' | 'api'
  /** Model id used by the tokenizer (encoding for tiktoken, repo for HF). */
  model?: string
  /** Remote endpoint, for the api-tokenizer backend. */
  endpoint?: string
  apiKey?: string
}
