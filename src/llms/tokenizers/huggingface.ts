/**
 * HuggingFace-backed tokenizer.
 *
 * Downloads `tokenizer.json` and `tokenizer_config.json` for the configured
 * repo from huggingface.co (caching them under
 * `~/.claude-code-router/.huggingface`) and feeds them to
 * `@huggingface/tokenizers` for real model-accurate token counts on
 * open-source models.
 */

import { Tokenizer as HFTokenizer } from '@huggingface/tokenizers'
import { existsSync, promises as fs, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Logger } from 'pino'
import type { ProviderTokenizerConfig } from '../types'
import { type TokenizeContentBlock, type TokenizeRequest, Tokenizer } from './base'

export interface HuggingFaceTokenizerOptions {
  /** Network timeout (ms) when downloading vocab files. Defaults to 30s. */
  timeout?: number
  /** Override the on-disk cache directory. */
  cacheDir?: string
  /** Optional pino logger; falls back to silence. */
  logger?: Logger
}

interface CachedTokenizerFiles {
  tokenizerJson: object
  tokenizerConfig: object
}

export class HuggingFaceTokenizer extends Tokenizer {
  private readonly modelId: string
  private readonly logger: Logger | undefined
  private readonly timeout: number
  private readonly cacheDir: string
  private readonly safeModelName: string
  private tokenizer: HFTokenizer | null = null

  constructor(config: ProviderTokenizerConfig, options: HuggingFaceTokenizerOptions = {}) {
    super()
    if (!config.model) {
      throw new Error('HuggingFace tokenizer requires `model` (the HF repo id)')
    }
    this.modelId = config.model
    this.logger = options.logger
    this.timeout = options.timeout ?? 30_000
    this.cacheDir = options.cacheDir ?? join(homedir(), '.claude-code-router', '.huggingface')
    // Cache safe model name to avoid repeated regex operations
    this.safeModelName = this.modelId.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  override async initialize(): Promise<void> {
    try {
      this.logger?.info(`Initializing HuggingFace tokenizer: ${this.modelId}`)
      this.ensureDir(this.cacheDir)

      const cached = await this.loadFromCache()
      const data = cached ?? (await this.downloadAndCache())
      this.tokenizer = new HFTokenizer(data.tokenizerJson, data.tokenizerConfig)

      this.logger?.info(`HuggingFace tokenizer initialized for ${this.modelId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.error(`Failed to initialize HuggingFace tokenizer: ${message}`)
      throw new Error(`Failed to initialize HuggingFace tokenizer for ${this.modelId}: ${message}`)
    }
  }

  async countTokens(request: TokenizeRequest): Promise<number> {
    const tokenizer = this.tokenizer
    if (!tokenizer) {
      throw new Error('Tokenizer not initialized')
    }
    try {
      const text = this.extractTextFromRequest(request)
      return tokenizer.encode(text).ids.length
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.error(`Error counting tokens: ${message}`)
      throw error
    }
  }

  // ─── cache helpers ────────────────────────────────────────────────────

  private getCachePaths(): { modelDir: string; tokenizerJson: string; tokenizerConfig: string } {
    const modelDir = join(this.cacheDir, this.safeModelName)
    return {
      modelDir,
      tokenizerJson: join(modelDir, 'tokenizer.json'),
      tokenizerConfig: join(modelDir, 'tokenizer_config.json')
    }
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private async loadFromCache(): Promise<CachedTokenizerFiles | null> {
    try {
      const paths = this.getCachePaths()
      if (!existsSync(paths.tokenizerJson) || !existsSync(paths.tokenizerConfig)) {
        return null
      }
      const [tokenizerJsonContent, tokenizerConfigContent] = await Promise.all([
        fs.readFile(paths.tokenizerJson, 'utf-8'),
        fs.readFile(paths.tokenizerConfig, 'utf-8')
      ])
      return {
        tokenizerJson: JSON.parse(tokenizerJsonContent) as object,
        tokenizerConfig: JSON.parse(tokenizerConfigContent) as object
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.warn(`Failed to load HF tokenizer from cache: ${message}`)
      return null
    }
  }

  private async downloadAndCache(): Promise<CachedTokenizerFiles> {
    const paths = this.getCachePaths()
    const urls = {
      json: `https://huggingface.co/${this.modelId}/resolve/main/tokenizer.json`,
      config: `https://huggingface.co/${this.modelId}/resolve/main/tokenizer_config.json`
    }

    this.logger?.info(`Downloading tokenizer files for ${this.modelId}`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const [jsonRes, configRes] = await Promise.all([
        fetch(urls.json, { signal: controller.signal }),
        fetch(urls.config, { signal: controller.signal })
      ])

      if (!jsonRes.ok) {
        throw new Error(`Failed to fetch tokenizer.json: ${jsonRes.statusText}`)
      }

      const [tokenizerJson, tokenizerConfig] = await Promise.all([
        jsonRes.json() as Promise<object>,
        configRes.ok ? (configRes.json() as Promise<object>) : Promise.resolve({})
      ])

      this.ensureDir(paths.modelDir)
      await Promise.all([
        fs.writeFile(paths.tokenizerJson, JSON.stringify(tokenizerJson, null, 2)),
        fs.writeFile(paths.tokenizerConfig, JSON.stringify(tokenizerConfig, null, 2))
      ])

      return { tokenizerJson, tokenizerConfig }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // ─── request → string flattening ──────────────────────────────────────

  private extractTextFromRequest(request: TokenizeRequest): string {
    const parts: string[] = []
    const { messages, system, tools } = request

    if (Array.isArray(messages)) {
      for (const message of messages) {
        if (typeof message.content === 'string') {
          parts.push(message.content)
        } else if (Array.isArray(message.content)) {
          for (const block of message.content) {
            const text = this.flattenContentBlock(block)
            if (text) parts.push(text)
          }
        }
      }
    }

    if (typeof system === 'string') {
      parts.push(system)
    } else if (Array.isArray(system)) {
      for (const item of system) {
        if (item.type !== 'text') continue
        if (typeof item.text === 'string') {
          parts.push(item.text)
        } else if (Array.isArray(item.text)) {
          for (const textPart of item.text) {
            if (textPart) parts.push(textPart)
          }
        }
      }
    }

    if (tools) {
      for (const tool of tools) {
        if (tool.name) parts.push(tool.name)
        if (tool.description) parts.push(tool.description)
        if (tool.input_schema) parts.push(JSON.stringify(tool.input_schema))
      }
    }

    return parts.join(' ')
  }

  private flattenContentBlock(block: TokenizeContentBlock): string {
    if (block.type === 'text') {
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    }
    if (block.type === 'tool_use') {
      const input = (block as { input?: unknown }).input
      return input === undefined ? '' : JSON.stringify(input)
    }
    if (block.type === 'tool_result') {
      const content = (block as { content?: unknown }).content
      if (content === undefined) return ''
      return typeof content === 'string' ? content : JSON.stringify(content)
    }
    return ''
  }
}
